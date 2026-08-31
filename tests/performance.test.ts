import test from "node:test";
import assert from "node:assert/strict";

import { createAgent } from "../src/agent/orchestrator.js";
import { ConversationMemory } from "../src/agent/memory.js";
import type { LlmProvider, LlmResponse } from "../src/types/llm.js";
import { MockRetriever } from "../src/retrieval/mock-retriever.js";
import { LlmCostOptimizer } from "../src/llm/cost-optimizer.js";

class CountingLlm implements LlmProvider {
  private callCount = 0;

  async generate(): Promise<LlmResponse> {
    this.callCount++;
    return {
      id: `call-${this.callCount}`,
      model: "counting-mock",
      text: "GraphRAG is a knowledge-enabled framework.",
    };
  }

  getCallCount(): number {
    return this.callCount;
  }
}

test("performance: response caching speeds up repeated queries", async () => {
  const memory = new ConversationMemory();
  const retriever = new MockRetriever();
  const llm = new CountingLlm();
  const agent = createAgent(memory, retriever, llm);

  const context = {
    tenantId: "perf-tenant",
    sessionId: "perf-session",
    question: "What is GraphRAG?",
  };

  const start1 = performance.now();
  const first = await agent.run(context);
  const duration1 = performance.now() - start1;

  const start2 = performance.now();
  const second = await agent.run(context);
  const duration2 = performance.now() - start2;

  assert.equal(first.text, second.text);
  assert.equal(llm.getCallCount(), 1, "Cached request should not invoke LLM again");
  assert.ok(duration2 < duration1 + 10, "Cache hit should be fast");
});

test("performance: deduplication joins concurrent identical requests", async () => {
  const memory = new ConversationMemory();
  const retriever = new MockRetriever();
  const llm = new CountingLlm();
  const agent = createAgent(memory, retriever, llm);

  const context = {
    tenantId: "perf-tenant-2",
    sessionId: "perf-session-2",
    question: "Explain vector search efficiency",
  };

  const [r1, r2, r3, r4, r5] = await Promise.all([
    agent.run(context),
    agent.run(context),
    agent.run(context),
    agent.run(context),
    agent.run(context),
  ]);

  assert.equal(r1.text, r2.text);
  assert.equal(r3.text, r4.text);
  assert.equal(r5.text, r1.text);
  assert.equal(llm.getCallCount(), 1, "Concurrent identical requests should deduplicate to 1 execution");
});

test("performance: cost optimizer tracks tokens, requests and estimated cost", () => {
  const optimizer = new LlmCostOptimizer();

  optimizer.recordUsage({
    promptTokens: 100,
    completionTokens: 50,
    totalTokens: 150,
  });

  optimizer.recordUsage({
    promptTokens: 200,
    completionTokens: 100,
    totalTokens: 300,
  });

  const metrics = optimizer.getMetrics();
  assert.equal(metrics.totalTokens, 450);
  assert.equal(metrics.totalRequests, 2);
  assert.equal(metrics.avgTokensPerRequest, 225);
  assert.ok(metrics.totalCostUsd > 0);
});
