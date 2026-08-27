import { validateInput } from "../guardrails/input-guard.js";
import { validateOutput } from "../guardrails/output-guard.js";
import { buildSystemPrompt, buildUserPrompt } from "../llm/prompts.js";
import type { LlmProvider } from "../llm/types.js";
import { verifyAnswerCitations } from "../services/citation-service.js";
import type {
  RetrievalResult,
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

const formatConversation = (
  messages: readonly Message[]
): string =>
  messages.map(({ role, content }) => `${role}: ${content}`).join("\n");

const formatKnowledge = (
  results: readonly RetrievalResult[]
): string =>
  results
    .map(({ content, source, page }) =>
      `[${source}${page !== undefined ? ` page ${page}` : ""}]\n${content}`
    )
    .join("\n\n");

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
    async run({
      tenantId,
      sessionId,
      question
    }: AgentContext): Promise<AgentExecutionResult> {
      const input = validateInput({ message: question });

      if (!input.allowed) {
        throw new Error(input.reason);
      }

      const history = memory.get(tenantId, sessionId);
      const conversationContext =
        history.length > 0 ? formatConversation(history) : undefined;

      const rewrittenQuestion = await queryRewriter.rewrite({
        question,
        ...(conversationContext !== undefined && {
          conversationContext
        })
      });

      const plan = createPlan({
        question: rewrittenQuestion,
        hasConversationContext: conversationContext !== undefined
      });

      const inputPrompt = buildUserPrompt({
        question: rewrittenQuestion,
        ...(conversationContext !== undefined && {
          conversationContext
        })
      });

      const initialResult =
        plan.action === "tool"
          ? await runToolCalling({
              instructions: buildSystemPrompt(),
              input: inputPrompt,
              registry: tools,
              maxRounds: 3
            })
          : await llm.generate({
              instructions: buildSystemPrompt(),
              input: inputPrompt
            });

      const results =
        plan.action === "retrieve"
          ? await retriever.search({
              query: rewrittenQuestion
            })
          : [];

      const knowledgeContext = formatKnowledge(results);

      const finalResult =
        results.length > 0
          ? await llm.generate({
              instructions: buildSystemPrompt(),
              input: buildUserPrompt({
                question: rewrittenQuestion,
                retrievedContext: [
                  knowledgeContext,
                  `Draft answer:\n${initialResult.text}`
                ].join("\n\n"),
                ...(conversationContext !== undefined && {
                  conversationContext
                })
              })
            })
          : initialResult;

      if (results.length > 0) {
        const citationResult = verifyAnswerCitations(
          finalResult.text,
          results
        );

        if (!citationResult.valid) {
          throw new Error(
            `Citation verification failed: ${citationResult.reason}`
          );
        }

        const critic = evaluateAnswer({
          question: rewrittenQuestion,
          answer: finalResult.text,
          context: knowledgeContext
        });

        if (!critic.passed) {
          throw new Error(
            `Answer verification failed: ${critic.reason}`
          );
        }
      }

      const output = validateOutput({
        response: finalResult.text
      });

      if (!output.allowed || output.response === undefined) {
        throw new Error(
          output.reason ?? "Generated response failed validation"
        );
      }

      memory.add(tenantId, sessionId, {
        role: "user",
        content: question
      });

      memory.add(tenantId, sessionId, {
        role: "assistant",
        content: output.response
      });

      return {
        text: output.response,
        model: finalResult.model,
        responseId: finalResult.id,
        sources: results
      };
    }
  };
};

export { createAgent };