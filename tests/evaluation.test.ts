import test from "node:test";
import assert from "node:assert/strict";

import { createAgent } from "../src/agent/orchestrator.js";
import { ConversationMemory } from "../src/agent/memory.js";
import type { LlmProvider } from "../src/llm/types.js";
import { MockRetriever } from "../src/retrieval/mock-retriever.js";
import { evaluationDataset } from "../src/evaluation/dataset.js";
import { evaluateDataset } from "../src/evaluation/evaluator.js";

const mockLlm: LlmProvider = {
  async generate({ input }) {
    const normalized = input.toLowerCase();

    switch (true) {
      case normalized.includes("refund"):
        return {
          id: "mock-refund",
          model: "mock",
          text: "The refund period is 30 days. [refund-policy.pdf page 4]",
        };

      case normalized.includes("pricing") ||
        normalized.includes("price") ||
        normalized.includes("cost"):
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

test("evaluates the Member 2 agent pipeline", async () => {
  const agent = createAgent(
    new ConversationMemory(),
    new MockRetriever(),
    mockLlm,
  );

  const report = await evaluateDataset(
    evaluationDataset,
    async (evaluationCase) =>
      agent.run({
        tenantId: "evaluation-tenant",
        sessionId: `evaluation-${evaluationCase.id}`,
        question: evaluationCase.question,
      }),
  );

  assert.equal(report.metrics.total, 3);
  assert.equal(report.metrics.passed, 3);
  assert.equal(report.metrics.failed, 0);
  assert.equal(report.metrics.passRate, 1);
  assert.equal(report.metrics.retrievalAccuracy, 1);
});
