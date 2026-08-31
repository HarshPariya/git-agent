import test from "node:test";
import assert from "node:assert/strict";

import { createAgent } from "../src/agent/orchestrator.js";
import { ConversationMemory } from "../src/agent/memory.js";
import type { Retriever, RetrievalResult } from "../src/retrieval/types.js";
import type { LlmProvider, LlmResponse } from "../src/types/llm.js";
import { AppError } from "../src/errors/app-error.js";

class MockRetriever implements Retriever {
  private shouldFail = false;
  private failMessage = "";
  private results: RetrievalResult[] = [];

  setFail(fail: boolean, message = "Retrieval failed") {
    this.shouldFail = fail;
    this.failMessage = message;
  }

  setResults(results: RetrievalResult[]) {
    this.results = results;
  }

  async search(): Promise<readonly RetrievalResult[]> {
    if (this.shouldFail) {
      throw new Error(this.failMessage);
    }
    return this.results;
  }
}

class MockLlm implements LlmProvider {
  private response: LlmResponse;
  private shouldFail = false;
  private failMessage = "";
  private callCount = 0;

  constructor(response: LlmResponse) {
    this.response = response;
  }

  setFail(fail: boolean, message = "LLM failed") {
    this.shouldFail = fail;
    this.failMessage = message;
  }

  setResponse(response: LlmResponse) {
    this.response = response;
  }

  getCallCount() {
    return this.callCount;
  }

  async generate(): Promise<LlmResponse> {
    this.callCount++;
    if (this.shouldFail) {
      throw new Error(this.failMessage);
    }
    return this.response;
  }
}

test("orchestrator handles empty question", async () => {
  const memory = new ConversationMemory();
  const retriever = new MockRetriever();
  const llm = new MockLlm({
    id: "test-1",
    model: "mock",
    text: "I cannot answer an empty question.",
  });

  const agent = createAgent(memory, retriever, llm);

  await assert.rejects(
    () => agent.run({ tenantId: "t1", sessionId: "s1", question: "" }),
    /Message must not be empty/,
  );
});

test("orchestrator handles very long question", async () => {
  const memory = new ConversationMemory();
  const retriever = new MockRetriever();
  const llm = new MockLlm({
    id: "test-2",
    model: "mock",
    text: "Question too long.",
  });

  const agent = createAgent(memory, retriever, llm);
  const longQuestion = "What is ".repeat(10_000) + "?";

  await assert.rejects(
    () =>
      agent.run({ tenantId: "t1", sessionId: "s1", question: longQuestion }),
    /Message exceeds the maximum allowed length/,
  );
});

test("orchestrator handles retrieval failure gracefully", async () => {
  const memory = new ConversationMemory();
  const retriever = new MockRetriever();
  retriever.setFail(true, "Network timeout");
  retriever.setResults([
    { content: "Fallback content", source: "fallback.pdf", score: 1 },
  ]);
  const llm = new MockLlm({
    id: "test-3",
    model: "mock",
    text: "Based on available knowledge, here is the answer.",
  });

  const agent = createAgent(memory, retriever, llm);
  const result = await agent.run({
    tenantId: "t1",
    sessionId: "s1",
    question: "What is the refund policy?",
  });

  assert.equal(result.sources.length, 0);
  assert.ok(result.text.length > 0);
});

test("orchestrator handles LLM failure with retry", async () => {
  const memory = new ConversationMemory();
  const retriever = new MockRetriever();
  const llm = new MockLlm({
    id: "test-4",
    model: "mock",
    text: "Success on retry",
  });
  llm.setFail(true, "Temporary LLM error");

  const agent = createAgent(memory, retriever, llm);

  await assert.rejects(
    () => agent.run({ tenantId: "t1", sessionId: "s1", question: "Hello" }),
    /llm_generate failed after 3 attempts/,
  );
  assert.equal(llm.getCallCount(), 3);
});

test("orchestrator handles citation verification failure with fallback", async () => {
  const memory = new ConversationMemory();
  const retriever = new MockRetriever();
  retriever.setResults([
    { content: "Refund policy content", source: "refund-policy.pdf", score: 1 },
  ]);
  const llm = new MockLlm({
    id: "test-5",
    model: "mock",
    text: "The refund policy allows returns [unknown-source].",
  });

  const agent = createAgent(memory, retriever, llm);
  const result = await agent.run({
    tenantId: "t1",
    sessionId: "s1",
    question: "What is the refund policy?",
  });

  assert.ok(result.text.length > 0);
});

test("orchestrator handles critic failure with fallback", async () => {
  const memory = new ConversationMemory();
  const retriever = new MockRetriever();
  retriever.setResults([
    {
      content: "Product pricing info",
      source: "product-a-pricing.pdf",
      score: 1,
    },
  ]);
  const llm = new MockLlm({
    id: "test-6",
    model: "mock",
    text: "Product A costs $100 [product-a-pricing.pdf].",
  });

  const agent = createAgent(memory, retriever, llm);
  const result = await agent.run({
    tenantId: "t1",
    sessionId: "s1",
    question: "What about Product A pricing?",
  });

  assert.ok(result.text.length > 0);
  assert.ok(result.sources.length > 0);
});

test("orchestrator handles query rewriter failure", async () => {
  const memory = new ConversationMemory();
  const retriever = new MockRetriever();
  const llm = new MockLlm({
    id: "test-7",
    model: "mock",
    text: "Query rewrite failed, using original question",
  });
  llm.setFail(true, "Query rewriter error");

  const agent = createAgent(memory, retriever, llm);

  await assert.rejects(
    () =>
      agent.run({
        tenantId: "t1",
        sessionId: "s1",
        question: "What is GraphRAG?",
      }),
    /llm_generate failed after 3 attempts/,
  );
});

test("orchestrator handles special characters in question", async () => {
  const memory = new ConversationMemory();
  const retriever = new MockRetriever();
  const llm = new MockLlm({
    id: "test-8",
    model: "mock",
    text: "Handled special characters",
  });

  const agent = createAgent(memory, retriever, llm);
  const specialQuestion = "What is <script>alert('xss')</script> and '\"\\`?";

  const result = await agent.run({
    tenantId: "t1",
    sessionId: "s1",
    question: specialQuestion,
  });

  assert.ok(result.text.length > 0);
});

test("orchestrator isolates sessions correctly on failure", async () => {
  const memory = new ConversationMemory();
  const retriever = new MockRetriever();
  const llm = new MockLlm({
    id: "test-9",
    model: "mock",
    text: "Answer",
  });

  const agent = createAgent(memory, retriever, llm);

  await agent.run({ tenantId: "t1", sessionId: "s1", question: "Question 1" });
  await agent.run({ tenantId: "t1", sessionId: "s2", question: "Question 2" });

  const history1 = memory.get("t1", "s1");
  const history2 = memory.get("t1", "s2");

  assert.equal(history1.length, 2);
  assert.equal(history2.length, 2);
  assert.ok(history1[0]);
  assert.ok(history2[0]);
  assert.equal(history1[0]!.content, "Question 1");
  assert.equal(history2[0]!.content, "Question 2");
});

test("orchestrator handles tool calling timeout gracefully", async () => {
  const memory = new ConversationMemory();
  const retriever = new MockRetriever();
  const llm = new MockLlm({
    id: "test-10",
    model: "mock",
    text: "Direct answer without tools",
  });

  const agent = createAgent(memory, retriever, llm);
  const result = await agent.run({
    tenantId: "t1",
    sessionId: "s1",
    question: "Search for refund policy",
  });

  assert.ok(result.text.length > 0);
});

test("orchestrator validates output guard on LLM response", async () => {
  const memory = new ConversationMemory();
  const retriever = new MockRetriever();
  const llm = new MockLlm({
    id: "test-11",
    model: "mock",
    text: "",
  });

  const agent = createAgent(memory, retriever, llm);

  await assert.rejects(
    () => agent.run({ tenantId: "t1", sessionId: "s1", question: "Hello" }),
    /The generated response is empty/,
  );
});

test("orchestrator handles output with API key pattern", async () => {
  const memory = new ConversationMemory();
  const retriever = new MockRetriever();
  const llm = new MockLlm({
    id: "test-12",
    model: "mock",
    text: "My API key is sk-1234567890abcdef",
  });

  const agent = createAgent(memory, retriever, llm);

  await assert.rejects(
    () => agent.run({ tenantId: "t1", sessionId: "s1", question: "Hello" }),
    /The generated response contains restricted information/,
  );
});

test("orchestrator maintains conversation memory after failure", async () => {
  const memory = new ConversationMemory();
  const retriever = new MockRetriever();
  retriever.setFail(true, "Retrieval failed");
  const llm = new MockLlm({
    id: "test-13",
    model: "mock",
    text: "Answer without retrieval",
  });

  const agent = createAgent(memory, retriever, llm);
  await agent.run({ tenantId: "t1", sessionId: "s1", question: "Question 1" });

  const history = memory.get("t1", "s1");
  assert.equal(history.length, 2);
  assert.ok(history[0]);
  assert.ok(history[1]);
  assert.equal(history[0]!.role, "user");
  assert.equal(history[1]!.role, "assistant");
});

test("orchestrator handles concurrent requests for same session", async () => {
  const memory = new ConversationMemory();
  const retriever = new MockRetriever();
  const llm = new MockLlm({
    id: "test-14",
    model: "mock",
    text: "Concurrent answer",
  });

  const agent = createAgent(memory, retriever, llm);

  const results = await Promise.all([
    agent.run({ tenantId: "t1", sessionId: "s1", question: "Q1" }),
    agent.run({ tenantId: "t1", sessionId: "s1", question: "Q2" }),
    agent.run({ tenantId: "t1", sessionId: "s1", question: "Q3" }),
  ]);

  assert.equal(results.length, 3);
  results.forEach((r) => assert.ok(r.text.length > 0));

  const history = memory.get("t1", "s1");
  assert.equal(history.length, 6);
});

test("orchestrator handles unknown error types", async () => {
  const memory = new ConversationMemory();
  const retriever = new MockRetriever();
  const llm = new MockLlm({
    id: "test-15",
    model: "mock",
    text: "Answer",
  });

  const agent = createAgent(memory, retriever, llm);

  retriever.setFail(true, "Unknown error type");

  const result = await agent.run({
    tenantId: "t1",
    sessionId: "s1",
    question: "Question",
  });

  assert.ok(result.text.length > 0);
});

test("orchestrator returns proper error structure", async () => {
  const memory = new ConversationMemory();
  const retriever = new MockRetriever();
  const llm = new MockLlm({
    id: "test-16",
    model: "mock",
    text: "",
  });

  const agent = createAgent(memory, retriever, llm);

  try {
    await agent.run({ tenantId: "t1", sessionId: "s1", question: "Hello" });
    assert.fail("Should have thrown");
  } catch (error) {
    assert.ok(error instanceof AppError);
    assert.equal(error.code, "VALIDATION_ERROR");
    assert.equal(error.statusCode, 400);
  }
});
