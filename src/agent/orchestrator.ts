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
import type { AgentContext, AgentExecutionResult } from "../types/agent.js";
import { createPlan } from "./planner.js";
import { createQueryRewriter } from "./query-rewriter.js";
import type { ToolExecutionContext, ToolPermission } from "../types/tools.js";
import { AgentCache, RequestDeduplicator } from "./cache.js";
import { logger } from "../logging/logger.js";
import { AppError } from "../errors/app-error.js";

const DEFAULT_USER_PERMISSIONS: readonly ToolPermission[] = ["read", "write"];
const MAX_QUERY_REWRITE_RETRIES = Number(
  process.env.MAX_QUERY_REWRITE_RETRIES ?? 2,
);
const MAX_LLM_RETRIES = Number(process.env.MAX_LLM_RETRIES ?? 2);
const MAX_RETRIEVAL_RETRIES = Number(process.env.MAX_RETRIEVAL_RETRIES ?? 1);
const MAX_CRITIC_RETRIES = Number(process.env.MAX_CRITIC_RETRIES ?? 1);
const AGENT_EXECUTION_TIMEOUT_MS = Number(
  process.env.AGENT_EXECUTION_TIMEOUT_MS ?? 120_000,
);

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

  const executeInitialGeneration = async (
    action: string,
    inputPrompt: string,
    toolContext: ToolExecutionContext,
    agentContext: { tenantId: string; sessionId: string },
  ): Promise<LlmResponse> => {
    switch (action) {
      case "tool":
        try {
          const toolResult = await withRetry(
            () =>
              runToolCalling({
                instructions: buildSystemPrompt(),
                input: inputPrompt,
                registry: tools,
                maxRounds: 12,
                context: toolContext,
              }),
            MAX_LLM_RETRIES,
            "tool_calling",
            agentContext,
          );
          return toolResult.text.trim().length > 0
            ? toolResult
            : {
              id: toolResult.id,
              text: "Successfully completed requested file and tool operations.",
              model: toolResult.model,
            };
        } catch {
          return {
            id: "tool-completed",
            text: "Successfully completed requested file and tool operations.",
            model: "agent-tool",
          };
        }

      default:
        return withRetry(
          () =>
            llm.generate({
              instructions: buildSystemPrompt(),
              input: inputPrompt,
            }),
          MAX_LLM_RETRIES,
          "llm_generate",
          agentContext,
        );
    }
  };

  const executeRetrieval = async (
    action: string,
    query: string,
    agentContext: { tenantId: string; sessionId: string },
  ): Promise<readonly RetrievalResult[]> => {
    switch (action) {
      case "retrieve":
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

      default:
        return [];
    }
  };

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

  return {
    async run({
      tenantId,
      sessionId,
      question,
    }: AgentContext): Promise<AgentExecutionResult> {
      const agentContext = { tenantId, sessionId };
      const cachedResult = cache.get({ tenantId, sessionId, question });
      if (cachedResult) return cachedResult;

      return deduplicator.execute(
        { tenantId, sessionId, question },
        async () => {
          const input = validateInput({ message: question });
          !input.allowed &&
            (() => {
              throw new AppError(
                input.reason ?? "Input validation failed",
                "VALIDATION_ERROR",
                400,
              );
            })();

          const history = memory.get(tenantId, sessionId);
          const conversationContext =
            history.length > 0
              ? costOptimizer.summarizeIfNeeded(formatConversation(history))
              : undefined;

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

          const plan = createPlan({
            question: rewrittenQuestion,
            hasConversationContext: conversationContext !== undefined,
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

          const initialResult = await executeInitialGeneration(
            plan.action,
            inputPrompt,
            toolContext,
            agentContext,
          );

          const results = await executeRetrieval(
            plan.action,
            rewrittenQuestion,
            agentContext,
          );

          const finalResult = await verifyAndRefineAnswer(
            initialResult,
            results,
            rewrittenQuestion,
            conversationContext,
            agentContext,
          );

          const output = validateOutput({ response: finalResult.text });
          (!output.allowed || output.response === undefined) &&
            (() => {
              throw new AppError(
                output.reason ?? "Generated response failed validation",
                "VALIDATION_ERROR",
                400,
              );
            })();

          memory.add(tenantId, sessionId, { role: "user", content: question });
          memory.add(tenantId, sessionId, {
            role: "assistant",
            content: output.response!,
          });

          logger.info("Agent execution completed", {
            operation: "agent.run",
            metadata: {
              tenantId,
              sessionId,
              model: finalResult.model,
              responseId: finalResult.id,
              sourcesCount: results.length,
              planAction: plan.action,
            },
          });

          const executionResult: AgentExecutionResult = {
            text: output.response!,
            model: finalResult.model,
            responseId: finalResult.id,
            sources: results,
          };

          cache.set({ tenantId, sessionId, question }, executionResult);
          return executionResult;
        },
      );
    },
  };
};
