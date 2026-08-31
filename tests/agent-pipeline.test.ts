import test from "node:test";
import assert from "node:assert/strict";

import { createAgent } from "../src/agent/orchestrator.js";
import { ConversationMemory } from "../src/agent/memory.js";
import type { LlmProvider } from "../src/llm/types.js";
import { MockRetriever } from "../src/retrieval/mock-retriever.js";

const mockLlm: LlmProvider = {
  async generate({ input }) {
    const normalized = input.toLowerCase();

    switch (true) {
      case normalized.includes("refund"):
        return {
          id: "pipeline-refund",
          model: "mock",
          text: "The refund period is 30 days. [refund-policy.pdf page 4]",
        };

      case normalized.includes("pricing") || normalized.includes("price"):
        return {
          id: "pipeline-pricing",
          model: "mock",
          text: "Product A is priced at $99 per month. [product-a-pricing.pdf page 3]",
        };

      default:
        return {
          id: "pipeline-general",
          model: "mock",
          text: "GraphRAG combines graph relationships with retrieval-augmented generation.",
        };
    }
  },
};

const createTestAgent = () =>
  createAgent(new ConversationMemory(), new MockRetriever(), mockLlm);

test("runs the complete direct-answer pipeline", async () => {
  const agent = createTestAgent();

  const result = await agent.run({
    tenantId: "tenant-1",
    sessionId: "pipeline-direct",
    question: "What is GraphRAG?",
  });

  assert.equal(result.model, "mock");
  assert.equal(result.responseId, "pipeline-general");
  assert.equal(result.sources.length, 0);
  assert.ok(result.text.length > 0);
});

test("runs the retrieval pipeline and returns sources", async () => {
  const agent = createTestAgent();

  const result = await agent.run({
    tenantId: "tenant-1",
    sessionId: "pipeline-retrieval",
    question: "What is the refund policy?",
  });

  assert.equal(result.model, "mock");
  assert.equal(result.sources.length, 2);
  assert.equal(result.sources[0]?.source, "refund-policy.pdf");
  assert.equal(result.responseId, "pipeline-refund");
  assert.match(result.text, /\[refund-policy\.pdf page 4\]/i);
});

test("serves system metrics deterministically without RAG citations", async () => {
  const agent = createTestAgent();

  const result = await agent.run({
    tenantId: "tenant-1",
    sessionId: "pipeline-system",
    question: "/metrics",
    documentIds: ["selected-document"],
    retrievalMode: "system",
  });

  assert.equal(result.model, "system-observability");
  assert.equal(result.sources.length, 0);
  assert.match(result.text, /rag_retrieval_requests_total/);
  assert.doesNotMatch(result.text, /provided documents/i);
});
