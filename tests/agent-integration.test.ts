import test from "node:test";
import assert from "node:assert/strict";

import { createAgent } from "../src/agent/orchestrator.js";
import { ConversationMemory } from "../src/agent/memory.js";
import type { LlmProvider } from "../src/llm/types.js";
import { MockRetriever } from "../src/retrieval/mock-retriever.js";

const mockLlm: LlmProvider = {
  async generate({ instructions, input }) {
    const lowerInput = input.toLowerCase();

    if (instructions.toLowerCase().includes("rewrite")) {
      return {
        id: "mock-rewrite",
        model: "mock",
        text: "What is the pricing of Product A?",
      };
    }

    switch (true) {
      case lowerInput.includes("refund"):
        return {
          id: "mock-refund",
          model: "mock",
          text: "The refund period is 30 days. [refund-policy.pdf page 4]",
        };

      case lowerInput.includes("pricing") || lowerInput.includes("price"):
        return {
          id: "mock-pricing",
          model: "mock",
          text: "Product A is priced at $99 per month. [product-a-pricing.pdf page 3]",
        };

      default:
        return {
          id: "mock-general",
          model: "mock",
          text: "GraphRAG combines graph relationships with retrieval-augmented generation.",
        };
    }
  },
};

const createTestAgent = () =>
  createAgent(new ConversationMemory(), new MockRetriever(), mockLlm);

test("answers a direct question", async () => {
  const agent = createTestAgent();

  const result = await agent.run({
    tenantId: "tenant-1",
    sessionId: "direct-test",
    question: "What is GraphRAG?",
  });

  assert.ok(result.text.length > 0);
  assert.equal(result.model, "mock");
  assert.equal(result.responseId, "mock-general");
  assert.deepEqual(result.sources, []);
});

test("retrieves knowledge for a retrieval question", async () => {
  const agent = createTestAgent();

  const result = await agent.run({
    tenantId: "tenant-1",
    sessionId: "retrieval-test",
    question: "What is the refund policy?",
  });

  assert.ok(result.text.length > 0);
  assert.equal(result.sources.length, 2);
  assert.equal(result.sources[0]?.source, "refund-policy.pdf");
  assert.match(result.text, /\[refund-policy\.pdf page 4\]/i);
});

test("maintains conversation context within a session", async () => {
  const agent = createTestAgent();
  const sessionId = "memory-test";

  const first = await agent.run({
    tenantId: "tenant-1",
    sessionId,
    question: "Tell me about Product A.",
  });

  const second = await agent.run({
    tenantId: "tenant-1",
    sessionId,
    question: "What about its pricing?",
  });

  assert.ok(first.text.length > 0);
  assert.ok(second.text.length > 0);
  assert.equal(second.responseId, "mock-pricing");
  assert.match(second.text, /\[product-a-pricing\.pdf page 3\]/i);
});
