import type { LlmProvider } from "../types/llm.js";
import type { QueryRewriteRequest } from "../types/agent.js";

export type { QueryRewriteRequest };

const REWRITE_INSTRUCTIONS = [
  "Rewrite the user's latest question as a standalone question.",
  "CRITICAL RULE: Use conversation context ONLY when the latest question contains ambiguous references, pronouns, or follow-up indicators (e.g. 'it', 'its', 'they', 'the product', 'that policy').",
  "If the latest question is an independent query (such as checking system health, asking general concepts, running file tools, or switching to a new topic), return the latest question EXACTLY as-is without adding prior context or prior entity names.",
  "Preserve the user's original intent and return ONLY the standalone rewritten question without commentary.",
].join(" ");

export const createQueryRewriter = (llm: LlmProvider) => ({
  rewrite: async ({
    question,
    conversationContext,
  }: QueryRewriteRequest): Promise<string> => {
    const trimmedQuestion = question.trim();
    const context = conversationContext?.trim();

    if (!context) return trimmedQuestion;

    try {
      const result = await llm.generate({
        instructions: REWRITE_INSTRUCTIONS,
        input: `Conversation context:\n${context}\n\nLatest question:\n${trimmedQuestion}`,
      });
      let rewritten = result.text.trim();
      if (rewritten.startsWith("Mock response for:")) {
        return trimmedQuestion;
      }
      if (rewritten.includes("Latest question:")) {
        const match = /Latest question:\s*([^\n]+)/i.exec(rewritten);
        if (match && match[1]?.trim()) {
          rewritten = match[1].trim();
        }
      }
      return rewritten.length > 0 ? rewritten : trimmedQuestion;
    } catch {
      return trimmedQuestion;
    }
  },
});
