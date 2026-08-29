import { validateInput } from "../guardrails/input-guard.js";
import { validateOutput } from "../guardrails/output-guard.js";
import { buildSystemPrompt, buildUserPrompt } from "../llm/prompts.js";
import type { LlmProvider } from "../llm/types.js";
import { verifyAnswerCitations } from "../services/citation-service.js";
import type { RetrievalResult, Retriever } from "../retrieval/types.js";
import { ToolRegistry } from "../tools/registry.js";
import { createKnowledgeTool } from "../tools/retrieve-knowledge.js";
import { runToolCalling } from "./tool-caller.js";
import { evaluateAnswer } from "./critic.js";
import { ConversationMemory, type Message } from "./memory.js";
import type { AgentContext, AgentExecutionResult } from "./types.js";
import { createPlan } from "./planner.js";
import { createQueryRewriter } from "./query-rewriter.js";
import type { ToolExecutionContext, ToolPermission } from "../tools/types.js";
import { logger } from "../logging/logger.js";
import { AppError } from "../errors/app-error.js";

const formatConversation = (messages: readonly Message[]): string =>
  messages.map(({ role, content }) => `${role}: ${content}`).join("\n");

const formatKnowledge = (results: readonly RetrievalResult[]): string =>
  results
    .map(
      ({ content, source, page }) =>
        `[${source}${page !== undefined ? ` page ${page}` : ""}]\n${content}`,
    )
    .join("\n\n");

const DEFAULT_USER_PERMISSIONS: readonly ToolPermission[] = ["read"];
const MAX_QUERY_REWRITE_RETRIES = 2;
const MAX_LLM_RETRIES = 2;
const MAX_RETRIEVAL_RETRIES = 1;
const MAX_CRITIC_RETRIES = 1;
const AGENT_EXECUTION_TIMEOUT_MS = 60_000;

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

      if (attempt < maxRetries) {
        await new Promise((resolve) =>
          setTimeout(resolve, 100 * (attempt + 1)),
        );
      }
    }
  }

  throw new AppError(
    `${operationName} failed after ${maxRetries + 1} attempts`,
    "INTERNAL_ERROR",
    500,
    { cause: lastError },
  );
};

const createAgent = (
  memory: ConversationMemory,
  retriever: Retriever,
  llm: LlmProvider,
) => {
  const queryRewriter = createQueryRewriter(llm);
  const tools = new ToolRegistry();

  tools.register(createKnowledgeTool((request) => retriever.search(request)));

  return {
    async run({
      tenantId,
      sessionId,
      question,
    }: AgentContext): Promise<AgentExecutionResult> {
      const agentContext = { tenantId, sessionId };

      const executeWithTimeout = async <T>(
        operation: () => Promise<T>,
        timeoutMs: number,
        operationName: string,
      ): Promise<T> => {
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(`${operationName} timed out after ${timeoutMs}ms`),
              ),
            timeoutMs,
          ),
        );
        return Promise.race([operation(), timeoutPromise]);
      };

      const input = validateInput({ message: question });

      if (!input.allowed) {
        throw new AppError(
          input.reason ?? "Input validation failed",
          "VALIDATION_ERROR",
          400,
        );
      }

      const history = memory.get(tenantId, sessionId);
      const conversationContext =
        history.length > 0 ? formatConversation(history) : undefined;

      const rewrittenQuestion = await executeWithTimeout(
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
        ...(conversationContext !== undefined && {
          conversationContext,
        }),
      });

      const toolContext: ToolExecutionContext = {
        tenantId,
        sessionId,
        userPermissions: DEFAULT_USER_PERMISSIONS,
      };

      let initialResult;
      let results: readonly RetrievalResult[] = [];

      // Handle tool calling with fallback
      if (plan.action === "tool") {
        try {
          initialResult = await withRetry(
            () =>
              runToolCalling({
                instructions: buildSystemPrompt(),
                input: inputPrompt,
                registry: tools,
                maxRounds: 3,
                context: toolContext,
              }),
            MAX_LLM_RETRIES,
            "tool_calling",
            agentContext,
          );
        } catch (error) {
          logger.warn("Tool calling failed, falling back to direct LLM", {
            operation: "tool_calling_fallback",
            metadata: {
              error: error instanceof Error ? error.message : String(error),
              tenantId,
              sessionId,
            },
          });
          initialResult = await withRetry(
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
      } else {
        initialResult = await withRetry(
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

      // Handle retrieval with fallback
      if (plan.action === "retrieve" || plan.action === "tool") {
        try {
          results = await withRetry(
            () => retriever.search({ query: rewrittenQuestion }),
            MAX_RETRIEVAL_RETRIES,
            "retrieval",
            agentContext,
          );
        } catch (error) {
          logger.warn(
            "Retrieval failed, proceeding without external knowledge",
            {
              operation: "retrieval_fallback",
              metadata: {
                error: error instanceof Error ? error.message : String(error),
                tenantId,
                sessionId,
              },
            },
          );
          results = [];
        }
      }

      const knowledgeContext = formatKnowledge(results);

      let finalResult;
      if (results.length > 0) {
        try {
          finalResult = await withRetry(
            () =>
              llm.generate({
                instructions: buildSystemPrompt(),
                input: buildUserPrompt({
                  question: rewrittenQuestion,
                  retrievedContext: [
                    knowledgeContext,
                    `Draft answer:\n${initialResult.text}`,
                  ].join("\n\n"),
                  ...(conversationContext !== undefined && {
                    conversationContext,
                  }),
                }),
              }),
            MAX_LLM_RETRIES,
            "llm_generate_with_context",
            agentContext,
          );
        } catch (error) {
          logger.warn(
            "LLM generation with context failed, using draft answer",
            {
              operation: "llm_context_fallback",
              metadata: {
                error: error instanceof Error ? error.message : String(error),
                tenantId,
                sessionId,
              },
            },
          );
          finalResult = initialResult;
        }
      } else {
        finalResult = initialResult;
      }

      if (results.length > 0) {
        const citationResult = verifyAnswerCitations(finalResult.text, results);

        if (!citationResult.valid) {
          logger.warn("Citation verification failed", {
            operation: "citation_verification",
            metadata: { reason: citationResult.reason, tenantId, sessionId },
          });
          throw new AppError(
            `Citation verification failed: ${citationResult.reason}`,
            "VALIDATION_ERROR",
            400,
          );
        }

        let criticResult = evaluateAnswer({
          question: rewrittenQuestion,
          answer: finalResult.text,
          context: knowledgeContext,
        });

        if (!criticResult.passed) {
          logger.warn("Answer critic failed, attempting regeneration", {
            operation: "critic",
            metadata: { reason: criticResult.reason, tenantId, sessionId },
          });

          for (
            let criticAttempt = 0;
            criticAttempt < MAX_CRITIC_RETRIES;
            criticAttempt++
          ) {
            const regeneratedResult = await withRetry(
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
              answer: regeneratedResult.text,
              context: knowledgeContext,
            });

            if (criticResult.passed) {
              finalResult = regeneratedResult;
              break;
            }
          }

          if (!criticResult.passed) {
            logger.warn(
              "Critic retries exhausted, falling back to draft answer",
              {
                operation: "critic_fallback",
                metadata: { tenantId, sessionId },
              },
            );
            finalResult = initialResult;
          }
        }
      }

      const output = validateOutput({
        response: finalResult.text,
      });

      if (!output.allowed || output.response === undefined) {
        throw new AppError(
          output.reason ?? "Generated response failed validation",
          "VALIDATION_ERROR",
          400,
        );
      }

      memory.add(tenantId, sessionId, {
        role: "user",
        content: question,
      });

      memory.add(tenantId, sessionId, {
        role: "assistant",
        content: output.response,
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

      return {
        text: output.response,
        model: finalResult.model,
        responseId: finalResult.id,
        sources: results,
      };
    },
  };
};

export { createAgent };
