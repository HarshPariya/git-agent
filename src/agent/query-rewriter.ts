import type { LlmProvider } from "../llm/types.js";

export interface QueryRewriteRequest {
  readonly question: string;
  readonly conversationContext?: string;
}

export const createQueryRewriter = (llm: LlmProvider) => ({
  rewrite: async ({
    question,
    conversationContext,
  }: QueryRewriteRequest): Promise<string> => {
    switch (Boolean(conversationContext?.trim())) {
      case false:
        return question.trim();

      default: {
        const result = await llm.generate({
          instructions: [
            "Rewrite the user's latest question as a standalone question.",
            "Use conversation context only to resolve missing references.",
            "Preserve the user's original intent.",
            "Return only the rewritten question.",
          ].join(" "),
          input: [
            `Conversation context:\n${conversationContext}`,
            `Latest question:\n${question}`,
          ].join("\n\n"),
        });

        const rewritten = result.text.trim();

        switch (rewritten.length) {
          case 0:
            return question.trim();

          default:
            return rewritten;
        }
      }
    }
  },
});
