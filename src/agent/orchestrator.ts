import { validateInput } from "../guardrails/input-guard.js";
import { validateOutput } from "../guardrails/output-guard.js";
import { buildSystemPrompt, buildUserPrompt } from "../llm/prompts.js";
import type { LlmProvider } from "../llm/types.js";
import { verifyAnswerCitations } from "../services/citation-service.js";
import type {
  Retriever
} from "../retrieval/types.js";
import { ToolRegistry } from "../tools/registry.js";
import { createKnowledgeTool } from "../tools/retrieve-knowledge.js";
import { runToolCalling } from "./tool-caller.js";
import { evaluateAnswer } from "./critic.js";
import {
  ConversationMemory,
  type Message
} from "./memory.js";
import type {
  AgentContext,
  AgentExecutionResult
} from "./types.js";
import { createPlan } from "./planner.js";
import { createQueryRewriter } from "./query-rewriter.js";

import { compressContext } from "../retrieval/context-compressor.js";
import { TokenBudgetManager } from "../llm/token-budget.js";
import { metricsCollector } from "../monitoring/observability.js";
import { env } from "../config/env.js";
import { isDocumentSummaryIntent } from "../retrieval/document-retriever.js";

const tokenManager = new TokenBudgetManager();

const formatConversation = (
  messages: readonly Message[],
  mode: "code" | "document" | "mixed" | "general" | "system",
): string =>
  messages
    .filter((message) => message.mode === mode)
    .map(({ role, content }) => `${role}: ${content}`)
    .join("\n");

const compactMemoryContent = (content: string): string =>
  content.replace(/\n\n\*\*Sources:\*\*[\s\S]*$/i, "").trim().slice(0, 800);

export function buildSystemObservabilityResponse(question: string): string {
  const normalized = question.toLowerCase().trim();

  if (normalized === "/metrics" || normalized.includes("prometheus")) {
    return `\`\`\`text\n${metricsCollector.getPrometheusFormat()}\n\`\`\``;
  }

  const metrics = metricsCollector.getMetrics();
  const summary = [
    `System status: **${metrics.healthScore.status}** (${metrics.healthScore.scorePercentage}%).`,
    `Retrieval requests: ${metrics.retrieval.totalRequests} total, ${metrics.retrieval.failedRequests} failed.`,
    `Retrieval latency: ${metrics.retrieval.avgLatencyMs} ms average, ${metrics.retrieval.percentiles.p95Ms} ms p95.`,
    `Database pool: ${metrics.database.poolTotalConnections} total, ${metrics.database.poolIdleConnections} idle, ${metrics.database.poolWaitingCount} waiting.`,
    `Graph cache hit rate: ${metrics.graphCache.hitRate}.`,
  ];

  if (normalized.includes("log")) {
    summary.push("Detailed request log lines are written to the server console; this chat exposes aggregate request metrics only.");
  }

  return summary.join("\n");
}



const createAgent = (
  memory: ConversationMemory,
  retriever: Retriever,
  llm: LlmProvider
) => {
  const queryRewriter = createQueryRewriter(llm);
  const tools = new ToolRegistry();

  tools.register(
    createKnowledgeTool((request) => retriever.search(request))
  );

  return {
    async run(request: AgentContext): Promise<AgentExecutionResult> {
      const { tenantId, sessionId, question, documentIds } = request;
      const input = validateInput({ message: question });

      if (!input.allowed) {
        return {
          responseId: `blocked-input-${Date.now()}`,
          model: "security-guardrail",
          text: `🛡️ **Request Blocked by Security Guardrail**: ${input.reason || "Prohibited instruction pattern detected."}`,
          sources: [],
        };
      }

      const history = memory.get(tenantId, sessionId);
      const selectedMode = request.retrievalMode ??
        (request.documentIds && request.documentIds.length > 0 ? "document" : "general");

      // Observability commands are deterministic application operations. They must
      // never be answered by the LLM or searched against code/uploaded documents.
      if (selectedMode === "system") {
        return {
          responseId: `system-observability-${Date.now()}`,
          model: "system-observability",
          text: buildSystemObservabilityResponse(question),
          sources: [],
        };
      }

      const summaryIntent = selectedMode === "document" && isDocumentSummaryIntent(question);
      const standaloneEntityLookup = /^[a-z0-9_$.-]+$/i.test(question.trim());
      const conversationContext = summaryIntent || standaloneEntityLookup
        ? undefined
        : formatConversation(history, selectedMode);

      const memoryBudget = tokenManager.fitMemory(conversationContext ?? "");

      const rewrittenQuestion = await queryRewriter.rewrite({
        question,
        ...(memoryBudget.formattedMemory.length > 0 && {
          conversationContext: memoryBudget.formattedMemory
        })
      });

      const plan = createPlan({
        question: rewrittenQuestion,
        hasConversationContext: memoryBudget.formattedMemory.length > 0
      });

      const inputPrompt = buildUserPrompt({
        question: rewrittenQuestion,
        ...(memoryBudget.formattedMemory.length > 0 && {
          conversationContext: memoryBudget.formattedMemory
        })
      });

      const effectiveMode = selectedMode;
      const loggedMode = summaryIntent ? "document_summary" : effectiveMode;
      const action = effectiveMode === "document" ? "retrieve" : plan.action;
      const startRetrieval = Date.now();

      const rawResults =
        action === "retrieve"
          ? await retriever.search({
              query: rewrittenQuestion,
              tenantId,
              ...(summaryIntent && { limit: 4 }),
              ...(request.documentIds !== undefined && { documentIds: request.documentIds }),
              ...(effectiveMode !== undefined && { mode: effectiveMode }),
            } as any)
          : [];
      const retrievalLatencyMs = Date.now() - startRetrieval;

      // Context Compression & Deduplication
      const unifiedCandidates = rawResults.map((r) => ({
        content: r.content,
        source: r.source,
        score: r.score,
        sourceType: ((r as any).sourceType ?? (r.metadata?.type === "document" ? "document" : "code")) as "code" | "document",
        pageNumber: r.page,
        ...(r.metadata !== undefined && { metadata: r.metadata }),
      }));

      const compressed = compressContext(unifiedCandidates, 4, 0.05);
      const budgetedEvidence = tokenManager.fitEvidence(compressed.evidence);

      console.log(
        `[RAG] mode=${loggedMode} query="${rewrittenQuestion}" selectedDocumentIds=${JSON.stringify(documentIds ?? [])} memoryTokens=${memoryBudget.memoryTokens} documentCandidates=${rawResults.filter((r: any) => r.sourceType === "document").length} codeCandidates=${rawResults.filter((r: any) => r.sourceType === "code").length} graphCandidates=${rawResults.filter((r: any) => r.metadata?.retrievalSources?.includes("graph")).length} finalEvidenceCount=${budgetedEvidence.evidenceItems.length} finalEvidenceTypes=${JSON.stringify([...new Set(budgetedEvidence.evidenceItems.map((item) => item.sourceType))])} contextTokens=${budgetedEvidence.ragContextTokens} retrievalLatencyMs=${retrievalLatencyMs}ms`
      );

      // Record Observability Metrics
      metricsCollector.recordRagMetrics({
        retrievalMode: loggedMode,
        retrievedCandidates: rawResults.length,
        rerankedCandidates: compressed.candidateCountAfterDeduplication,
        sentToLLM: budgetedEvidence.evidenceItems.length,
        ragContextTokens: budgetedEvidence.ragContextTokens,
        memoryTokens: memoryBudget.memoryTokens,
        systemTokens: 120,
        queryTokens: Math.ceil(rewrittenQuestion.length / 4),
        llmInputTokens: 120 + Math.ceil(rewrittenQuestion.length / 4) + memoryBudget.memoryTokens + budgetedEvidence.ragContextTokens,
        llmOutputTokens: 200,
      });

      const symbolEvidence = rawResults.filter(
        (result) => result.metadata?.type === "symbol_lookup" && result.metadata.pathValidated === "true",
      );
      if (env.ragDebugContext) {
        console.log(`[RAG TOP EVIDENCE]\n${budgetedEvidence.evidenceItems.map((item) => `[${item.id}] ${item.sourceType} ${item.source}\n${item.content}`).join("\n\n")}`);
        console.log(`[RAG CONTEXT SENT TO GROQ]\n${budgetedEvidence.formattedEvidence}`);
      }
      const deterministicSymbolText = symbolEvidence.length > 0
        ? symbolEvidence.map((result, index) => {
            const symbol = result.metadata?.symbol ?? "The symbol";
            const filePath = result.metadata?.filePath ?? result.source;
            const startLine = result.metadata?.startLine ?? "?";
            const endLine = result.metadata?.endLine ?? startLine;
            return `\`${symbol}\` is implemented in \`${filePath}\` at lines ${startLine}-${endLine} [S${index + 1}].`;
          }).join("\n")
        : undefined;

      const finalResult =
        deterministicSymbolText !== undefined
          ? { id: `symbol-lookup-${Date.now()}`, model: "deterministic-repository-lookup", text: deterministicSymbolText }
          : budgetedEvidence.evidenceItems.length > 0
          ? await llm.generate({
              instructions: buildSystemPrompt(effectiveMode),
              input: buildUserPrompt({
                question: rewrittenQuestion,
                retrievedContext: budgetedEvidence.formattedEvidence,
                ...(memoryBudget.formattedMemory.length > 0 && {
                  conversationContext: memoryBudget.formattedMemory
                })
              })
            })
          : plan.action === "tool"
          ? await runToolCalling({
              instructions: buildSystemPrompt(effectiveMode),
              input: inputPrompt,
              registry: tools,
              maxRounds: 3
            })
          : await llm.generate({
              instructions: buildSystemPrompt(effectiveMode),
              input: inputPrompt
            });

      const results = rawResults;

      let finalText = finalResult.text;

      if (results.length > 0) {
        const citationSources = [
          ...results,
          ...budgetedEvidence.evidenceItems.map((item) => ({
            content: item.content,
            source: item.id,
            ...(item.page !== undefined && { page: item.page }),
            score: item.score,
          })),
        ];
        const citationResult = verifyAnswerCitations(
          finalText,
          citationSources
        );

        if (!citationResult.valid) {
          const autoCitations = budgetedEvidence.evidenceItems.map((item) => `[${item.id}]`).join(" ");
          finalText = `${finalText}\n\n**Sources:** ${autoCitations}`;
        }

        const critic = evaluateAnswer({
          question: rewrittenQuestion,
          answer: finalText,
          context: budgetedEvidence.formattedEvidence
        });

        if (!critic.passed) {
          console.warn("⚠️ Critic answer warning:", critic.reason);
        }
      }

      const output = validateOutput({
        response: finalText
      });

      if (!output.allowed || output.response === undefined) {
        return {
          responseId: `blocked-output-${Date.now()}`,
          model: "security-guardrail",
          text: `🛡️ **Response Blocked by Security Guardrail**: ${output.reason || "Generated response failed security validation."}`,
          sources: [],
        };
      }

      memory.add(tenantId, sessionId, {
        role: "user",
        content: question,
        mode: selectedMode,
      });

      memory.add(tenantId, sessionId, {
        role: "assistant",
        content: compactMemoryContent(output.response),
        mode: selectedMode,
      });

      const filteredSources =
        effectiveMode === "document"
          ? results.filter((r) => (r as any).sourceType === "document")
          : effectiveMode === "code"
          ? results.filter((r) => (r as any).sourceType !== "document")
          : results;

      return {
        text: output.response,
        model: finalResult.model,
        responseId: finalResult.id,
        sources: filteredSources
      };
    }
  };
};

export { createAgent };
