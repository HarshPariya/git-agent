import test from "node:test";
import assert from "node:assert/strict";

import { createQueryRewriter } from "../src/agent/query-rewriter.js";
import type { LlmProvider } from "../src/types/llm.js";

const mockLlm: LlmProvider = {
  async generate() {
    return {
      id: "mock-rewrite",
      model: "mock",
      text: "What is the pricing of Product A?",
    };
  },
};

test("returns the original question without conversation context", async () => {
  const rewriter = createQueryRewriter(mockLlm);
  const question = "What is GraphRAG?";

  const result = await rewriter.rewrite({ question });

  assert.equal(result, question);
});

test("rewrites contextual questions using the injected LLM", async () => {
  const rewriter = createQueryRewriter(mockLlm);

  const result = await rewriter.rewrite({
    question: "What about its pricing?",
    conversationContext: "User: Tell me about Product A.",
  });

  assert.equal(result, "What is the pricing of Product A?");
});
