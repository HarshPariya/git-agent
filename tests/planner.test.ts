import test from "node:test";
import assert from "node:assert/strict";

import { createPlan } from "../src/agent/planner.js";

test("selects direct answer for general questions", () => {
  const plan = createPlan({
    question: "Hello there!",
    hasConversationContext: false,
  });

  assert.equal(plan.action, "direct_answer");
});

test("selects a direct general answer for a RAG definition", () => {
  const plan = createPlan({ question: "What is RAG?", hasConversationContext: false });
  assert.equal(plan.action, "direct_answer");
});

test("selects retrieval for knowledge-dependent questions", () => {
  const plan = createPlan({
    question: "What is the refund policy?",
    hasConversationContext: false,
  });

  assert.equal(plan.action, "retrieve");
});

test("selects a tool when the question explicitly requires one", () => {
  const plan = createPlan({
    question: "Calculate the total price.",
    hasConversationContext: false,
  });

  assert.equal(plan.action, "tool");
});
