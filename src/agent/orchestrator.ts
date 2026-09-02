import { validateInput } from "../guardrails/input-guard.js";
import { validateOutput } from "../guardrails/output-guard.js";
import { buildSystemPrompt, buildUserPrompt } from "../llm/prompts.js";
import type { LlmProvider, LlmResponse } from "../types/llm.js";
import { LlmCostOptimizer, type TokenUsage } from "../llm/cost-optimizer.js";
import { verifyAnswerCitations } from "../services/citation-service.js";
import type { RetrievalResult, Retriever } from "../retrieval/types.js";
import { ToolRegistry } from "../tools/registry.js";
import { createKnowledgeTool } from "../tools/retrieve-knowledge.js";
import { createListDirectoryTool } from "../tools/list-directory.js";
import { createReadFileTool } from "../tools/read-file.js";
import { createGitStatusTool } from "../tools/git-status.js";
import { createEditFileTool } from "../tools/edit-file.js";
import { createWriteFileTool } from "../tools/write-file.js";
import { createDeleteFileTool } from "../tools/delete-file.js";
import { runToolCalling } from "./tool-caller.js";
import { evaluateAnswer } from "./critic.js";
import { ConversationMemory, type Message } from "./memory.js";
import type {
  AgentContext,
  AgentExecutionResult,
  ToolActivity,
} from "../types/agent.js";
import { createPlan } from "./planner.js";
import { createQueryRewriter } from "./query-rewriter.js";
import type { ToolExecutionContext, ToolPermission } from "../types/tools.js";
import { AgentCache, RequestDeduplicator } from "./cache.js";
import { logger } from "../logging/logger.js";
import { AppError } from "../errors/app-error.js";

// ──────────────────────────────────────────────────────────────────────────────
// Configuration (env-configurable with safe defaults)
// ──────────────────────────────────────────────────────────────────────────────
const DEFAULT_USER_PERMISSIONS: readonly ToolPermission[] = ["read", "write"];
const MAX_QUERY_REWRITE_RETRIES = Number(
  process.env.MAX_QUERY_REWRITE_RETRIES ?? 2,
);
const MAX_LLM_RETRIES = Number(process.env.MAX_LLM_RETRIES ?? 2);
const MAX_RETRIEVAL_RETRIES = Number(process.env.MAX_RETRIEVAL_RETRIES ?? 1);
const MAX_CRITIC_RETRIES = Number(process.env.MAX_CRITIC_RETRIES ?? 1);
const MAX_TOOL_ROUNDS = Number(process.env.MAX_TOOL_ROUNDS ?? 12);
const AGENT_EXECUTION_TIMEOUT_MS = Number(
  process.env.AGENT_EXECUTION_TIMEOUT_MS ?? 120_000,
);

// ──────────────────────────────────────────────────────────────────────────────
// Utilities
// ──────────────────────────────────────────────────────────────────────────────
const formatConversation = (messages: readonly Message[]): string =>
  messages.map(({ role, content }) => `${role}: ${content}`).join("\n");

const formatKnowledge = (results: readonly RetrievalResult[]): string =>
  results
    .map(
      ({ content, source, page }) =>
        `[${source}${page !== undefined ? ` page ${page}` : ""}]\n${content}`,
    )
    .join("\n\n");

const withTimeout = async <T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  operationName: string,
): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(new Error(`${operationName} timed out after ${timeoutMs}ms`)),
        timeoutMs,
      );
    });
    return await Promise.race([operation(), timeoutPromise]);
  } finally {
    timer && clearTimeout(timer);
  }
};

const withRetry = async <T>(
  operation: () => Promise<T>,
  maxRetries: number,
  operationName: string,
  context: { tenantId: string; sessionId: string },
): Promise<T> => {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      logger.warn(`${operationName} attempt ${attempt + 1} failed`, {
        operation: operationName,
        metadata: {
          attempt: attempt + 1,
          maxRetries: maxRetries + 1,
          error: lastError.message,
          tenantId: context.tenantId,
          sessionId: context.sessionId,
        },
      });

      attempt < maxRetries &&
        (await new Promise((resolve) =>
          setTimeout(resolve, 100 * (attempt + 1)),
        ));
    }
  }

  throw new AppError(
    `${operationName} failed after ${maxRetries + 1} attempts`,
    "INTERNAL_ERROR",
    500,
    { cause: lastError },
  );
};

// ──────────────────────────────────────────────────────────────────────────────
// STATIC REFUSAL / CLARIFICATION MESSAGES
// ──────────────────────────────────────────────────────────────────────────────
const REFUSE_RESPONSE = `I'm unable to fulfill that request. It involves a prohibited operation — such as exposing credentials, accessing protected system files, deleting critical project resources, escalating privileges, or bypassing security guardrails.

If you believe this is a mistake and you have a legitimate need, please contact the system administrator.`;

const buildClarifyResponse = (question: string): string =>
  `I need a bit more information to help you effectively.

Your request — **"${question}"** — is ambiguous. Could you clarify:

- **What specific file, folder, or resource** are you referring to?
- **What exact operation** would you like performed?
- **What outcome** are you expecting?

This ensures I take the correct action safely.`;

// ──────────────────────────────────────────────────────────────────────────────
// Agent Factory
// ──────────────────────────────────────────────────────────────────────────────
export const createAgent = (
  memory: ConversationMemory,
  retriever: Retriever,
  llm: LlmProvider,
) => {
  const queryRewriter = createQueryRewriter(llm);
  const tools = new ToolRegistry();
  const cache = new AgentCache();
  const deduplicator = new RequestDeduplicator();
  const costOptimizer = new LlmCostOptimizer();

  tools.register(createKnowledgeTool((request) => retriever.search(request)));
  tools.register(createListDirectoryTool());
  tools.register(createReadFileTool());
  tools.register(createGitStatusTool());
  tools.register(createEditFileTool());
  tools.register(createWriteFileTool());
  tools.register(createDeleteFileTool());

  // ── LLM generation with cost optimization (caching + token tracking) ────
  const generateWithOptimizer = async (
    instructions: string,
    input: string,
  ): Promise<LlmResponse> => {
    const rateLimit = costOptimizer.checkRateLimit();
    !rateLimit.allowed &&
      (await new Promise((resolve) =>
        setTimeout(resolve, rateLimit.retryAfterMs ?? 1000),
      ));

    const cached = costOptimizer.getCachedResponse(instructions, input);
    if (cached) {
      costOptimizer.recordUsage(cached.tokens);
      return {
        id: "cost-cache-hit",
        model: "cost-optimized",
        text: cached.text,
      };
    }

    const response = await llm.generate({ instructions, input });
    const promptTokens =
      Math.ceil(instructions.length / 4) + Math.ceil(input.length / 4);
    const completionTokens = Math.ceil(response.text.length / 4);
    const tokens: TokenUsage = {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
    };

    costOptimizer.cacheResponse(instructions, input, response.text, tokens);
    costOptimizer.recordUsage(tokens);
    return response;
  };

  // ── Tool Execution Path ──────────────────────────────────────────────────
  const executeToolPath = async (
    inputPrompt: string,
    toolContext: ToolExecutionContext,
    agentContext: { tenantId: string; sessionId: string },
  ): Promise<{ response: LlmResponse; toolActivity: ToolActivity[] }> => {
    const toolActivity: ToolActivity[] = [];

    try {
      const result = await withRetry(
        () =>
          runToolCalling({
            instructions: buildSystemPrompt(),
            input: inputPrompt,
            registry: tools,
            maxRounds: MAX_TOOL_ROUNDS,
            context: toolContext,
            onToolResult: (name, success, durationMs, error) => {
              toolActivity.push({ toolName: name, success, durationMs, error });
            },
          }),
        MAX_LLM_RETRIES,
        "tool_calling",
        agentContext,
      );

      return { response: result, toolActivity };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger.warn("Tool calling failed, returning error response", {
        operation: "tool_path",
        metadata: { error: errMsg, ...agentContext },
      });

      return {
        response: {
          id: "tool-error",
          model: "agent-tool",
          text: `⚠️ **Tool execution encountered an error**: ${errMsg}\n\nPlease verify your request and try again. If the issue persists, check that the target file or resource exists and is accessible.`,
        },
        toolActivity,
      };
    }
  };

  // ── Retrieval Path ────────────────────────────────────────────────────────
  const executeRetrieval = async (
    query: string,
    agentContext: { tenantId: string; sessionId: string },
  ): Promise<readonly RetrievalResult[]> => {
    try {
      return await withRetry(
        () => retriever.search({ query }),
        MAX_RETRIEVAL_RETRIES,
        "retrieval",
        agentContext,
      );
    } catch {
      return [];
    }
  };

  // ── Citation + Critic Refinement ─────────────────────────────────────────
  const verifyAndRefineAnswer = async (
    initialResult: LlmResponse,
    results: readonly RetrievalResult[],
    rewrittenQuestion: string,
    conversationContext: string | undefined,
    agentContext: { tenantId: string; sessionId: string },
  ): Promise<LlmResponse> => {
    if (results.length === 0) return initialResult;

    const knowledgeContext = formatKnowledge(results);
    let currentResult: LlmResponse;

    try {
      currentResult = await withRetry(
        () =>
          generateWithOptimizer(
            buildSystemPrompt(),
            buildUserPrompt({
              question: rewrittenQuestion,
              retrievedContext: [
                knowledgeContext,
                `Draft answer:\n${initialResult.text}`,
              ].join("\n\n"),
              ...(conversationContext !== undefined && { conversationContext }),
            }),
          ),
        MAX_LLM_RETRIES,
        "llm_generate_with_context",
        agentContext,
      );
    } catch {
      currentResult = initialResult;
    }

    const citationResult = verifyAnswerCitations(currentResult.text, results);
    if (!citationResult.valid) {
      try {
        const regenerated = await withRetry(
          () =>
            llm.generate({
              instructions: buildSystemPrompt(),
              input: buildUserPrompt({
                question: rewrittenQuestion,
                retrievedContext: [
                  knowledgeContext,
                  `Draft answer:\n${currentResult.text}`,
                  `Citation verification failed: ${citationResult.reason}. Provide a corrected answer with proper citations from the context using [source] or [source page N] format.`,
                ].join("\n\n"),
                ...(conversationContext !== undefined && {
                  conversationContext,
                }),
              }),
            }),
          MAX_LLM_RETRIES,
          "llm_regenerate_for_citations",
          agentContext,
        );

        currentResult = verifyAnswerCitations(regenerated.text, results).valid
          ? regenerated
          : initialResult;
      } catch {
        currentResult = initialResult;
      }
    }

    let criticResult = evaluateAnswer({
      question: rewrittenQuestion,
      answer: currentResult.text,
      context: knowledgeContext,
    });

    if (!criticResult.passed) {
      for (let attempt = 0; attempt < MAX_CRITIC_RETRIES; attempt++) {
        try {
          const regenerated = await withRetry(
            () =>
              llm.generate({
                instructions: buildSystemPrompt(),
                input: buildUserPrompt({
                  question: rewrittenQuestion,
                  retrievedContext: [
                    knowledgeContext,
                    `Previous answer failed critic: ${criticResult.reason}. Provide a corrected answer with citations from the context.`,
                  ].join("\n\n"),
                  ...(conversationContext !== undefined && {
                    conversationContext,
                  }),
                }),
              }),
            MAX_LLM_RETRIES,
            "llm_regenerate_for_critic",
            agentContext,
          );

          criticResult = evaluateAnswer({
            question: rewrittenQuestion,
            answer: regenerated.text,
            context: knowledgeContext,
          });

          if (criticResult.passed) {
            currentResult = regenerated;
            break;
          }
        } catch {
          break;
        }
      }

      currentResult = criticResult.passed ? currentResult : initialResult;
    }

    return currentResult;
  };

  // ── Main Agent Run ────────────────────────────────────────────────────────
  return {
    async run({
      tenantId,
      sessionId,
      question,
    }: AgentContext): Promise<AgentExecutionResult> {
      const agentContext = { tenantId, sessionId };

      // ── Cache Check ──────────────────────────────────────────────────────
      const cachedResult = cache.get({ tenantId, sessionId, question });
      if (cachedResult) return cachedResult;

      return deduplicator.execute(
        { tenantId, sessionId, question },
        async () => {
          // ── Input Guard ────────────────────────────────────────────────
          const input = validateInput({ message: question });
          !input.allowed &&
            (() => {
              throw new AppError(
                input.reason ?? "Input validation failed",
                "VALIDATION_ERROR",
                400,
              );
            })();

          // ── Conversation Memory ────────────────────────────────────────
          const history = memory.get(tenantId, sessionId);
          const conversationContext =
            history.length > 0
              ? costOptimizer.summarizeIfNeeded(formatConversation(history))
              : undefined;

          // ── Query Rewriting ────────────────────────────────────────────
          const rewrittenQuestion = await withTimeout(
            () =>
              withRetry(
                () =>
                  queryRewriter.rewrite({
                    question,
                    ...(conversationContext !== undefined && {
                      conversationContext,
                    }),
                  }),
                MAX_QUERY_REWRITE_RETRIES,
                "query_rewrite",
                agentContext,
              ),
            AGENT_EXECUTION_TIMEOUT_MS,
            "query_rewrite",
          );

          // ── Intent Routing (Planner) ────────────────────────────────────
          const plan = createPlan({
            question: rewrittenQuestion,
            hasConversationContext: conversationContext !== undefined,
          });

          logger.info("Agent plan created", {
            operation: "agent.plan",
            metadata: {
              tenantId,
              sessionId,
              action: plan.action,
              reason: plan.reason,
            },
          });

          const inputPrompt = buildUserPrompt({
            question: rewrittenQuestion,
            ...(conversationContext !== undefined && { conversationContext }),
          });

          const toolContext: ToolExecutionContext = {
            tenantId,
            sessionId,
            userPermissions: DEFAULT_USER_PERMISSIONS,
          };

          // ── Dispatch by Action ──────────────────────────────────────────
          let finalResult: LlmResponse;
          let sources: readonly RetrievalResult[] = [];
          let toolActivity: ToolActivity[] = [];

          switch (plan.action) {
            // ── REFUSE ──────────────────────────────────────────────────
            case "refuse": {
              finalResult = {
                id: "refused",
                model: "security-policy",
                text: REFUSE_RESPONSE,
              };
              break;
            }

            // ── CLARIFY ─────────────────────────────────────────────────
            case "clarify": {
              finalResult = {
                id: "clarify",
                model: "clarification-policy",
                text: buildClarifyResponse(question),
              };
              break;
            }

            // ── TOOL EXECUTION ───────────────────────────────────────────
            case "tool": {
              const toolResult = await executeToolPath(
                inputPrompt,
                toolContext,
                agentContext,
              );
              finalResult = toolResult.response;
              toolActivity = toolResult.toolActivity;
              break;
            }

            // ── KNOWLEDGE RETRIEVAL ──────────────────────────────────────
            case "retrieve": {
              sources = await executeRetrieval(rewrittenQuestion, agentContext);

              const initialResult = await withRetry(
                () =>
                  generateWithOptimizer(
                    buildSystemPrompt(),
                    buildUserPrompt({
                      question: rewrittenQuestion,
                      ...(sources.length > 0 && {
                        retrievedContext: formatKnowledge(sources),
                      }),
                      ...(conversationContext !== undefined && {
                        conversationContext,
                      }),
                    }),
                  ),
                MAX_LLM_RETRIES,
                "llm_generate",
                agentContext,
              );

              finalResult = await verifyAndRefineAnswer(
                initialResult,
                sources,
                rewrittenQuestion,
                conversationContext,
                agentContext,
              );
              break;
            }

            // ── DIRECT ANSWER ────────────────────────────────────────────
            case "direct_answer":
            default: {
              finalResult = await withRetry(
                () =>
                  generateWithOptimizer(buildSystemPrompt(), inputPrompt),
                MAX_LLM_RETRIES,
                "llm_generate",
                agentContext,
              );
              break;
            }
          }

          // ── Output Guard ──────────────────────────────────────────────
          const output = validateOutput({ response: finalResult.text });
          (!output.allowed || output.response === undefined) &&
            (() => {
              throw new AppError(
                output.reason ?? "Generated response failed validation",
                "VALIDATION_ERROR",
                400,
              );
            })();

          // ── Persist to Memory ────────────────────────────────────────
          memory.add(tenantId, sessionId, { role: "user", content: question });
          memory.add(tenantId, sessionId, {
            role: "assistant",
            content: output.response!,
          });

          // ── Observability Log ────────────────────────────────────────
          logger.info("Agent execution completed", {
            operation: "agent.run",
            metadata: {
              tenantId,
              sessionId,
              model: finalResult.model,
              responseId: finalResult.id,
              sourcesCount: sources.length,
              planAction: plan.action,
              toolsUsed: toolActivity.map((t) => t.toolName),
              toolSuccessCount: toolActivity.filter((t) => t.success).length,
            },
          });

          const executionResult: AgentExecutionResult = {
            text: output.response!,
            model: finalResult.model,
            responseId: finalResult.id,
            sources,
            toolActivity,
          };

          cache.set({ tenantId, sessionId, question }, executionResult);
          return executionResult;
        },
      );
    },
  };
};
