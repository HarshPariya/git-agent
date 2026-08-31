import type { LlmProvider } from "../types/llm.js";
import type { QueryRewriteRequest } from "../types/agent.js";

export type { QueryRewriteRequest };

const REWRITE_INSTRUCTIONS = [
  "Rewrite the user's latest question as a standalone question.",
  "Use conversation context only to resolve missing references.",
  "Preserve the user's original intent.",
  "Return only the rewritten question.",
].join(" ");

export const createQueryRewriter = (llm: LlmProvider) => ({
  rewrite: async ({
    question,
    conversationContext,
  }: QueryRewriteRequest): Promise<string> => {
    const trimmedQuestion = question.trim();
    const context = conversationContext?.trim();

    return !context
      ? trimmedQuestion
      : (async () => {
        const result = await llm.generate({
          instructions: REWRITE_INSTRUCTIONS,
          input: `Conversation context:\n${context}\n\nLatest question:\n${trimmedQuestion}`,
        });
        const rewritten = result.text.trim();
        return rewritten.length > 0 ? rewritten : trimmedQuestion;
      })();
  },
});
