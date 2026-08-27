import test from "node:test";
import assert from "node:assert/strict";

import { evaluateAnswer } from "../src/agent/critic.js";

test("passes a supported answer", () => {
  const result = evaluateAnswer({
    question: "What is the refund period?",
    answer: "The refund period is 30 days.",
    context: "Customers can request a refund within 30 days of purchase.",
  });

  assert.equal(result.passed, true);
});

test("rejects an empty answer", () => {
  const result = evaluateAnswer({
    question: "What is the refund period?",
    answer: "",
    context: "Refunds are available within 30 days.",
  });

  assert.equal(result.passed, false);
  assert.match(result.reason, /empty/i);
});

test("rejects missing context", () => {
  const result = evaluateAnswer({
    question: "What is the refund period?",
    answer: "The refund period is 30 days.",
    context: "",
  });

  assert.equal(result.passed, false);
  assert.match(result.reason, /context/i);
});

test("rejects unsupported answers", () => {
  const result = evaluateAnswer({
    question: "What is the refund period?",
    answer: "The refund period is 90 days.",
    context: "Customers can request a refund within 30 days of purchase.",
  });

  assert.equal(result.passed, false);
});

test("rejects answers unrelated to the question", () => {
  const result = evaluateAnswer({
    question: "What is the refund period?",
    answer: "The company operates in several countries.",
    context: "Customers can request a refund within 30 days of purchase.",
  });

  assert.equal(result.passed, false);
});
