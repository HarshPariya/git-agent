import test from "node:test";
import assert from "node:assert/strict";

import { validateOutput } from "../src/guardrails/output-guard.js";

test("allows a normal response", () => {
  const result = validateOutput({
    response: "The refund period is 30 days.",
  });

  assert.equal(result.allowed, true);
  assert.equal(result.response, "The refund period is 30 days.");
});

test("rejects an empty response", () => {
  const result = validateOutput({
    response: "   ",
  });

  assert.equal(result.allowed, false);
});

test("rejects an oversized response", () => {
  const result = validateOutput({
    response: "a".repeat(8_001),
  });

  assert.equal(result.allowed, false);
});

test("rejects API key disclosure", () => {
  const result = validateOutput({
    response: "api_key=sk-example-secret",
  });

  assert.equal(result.allowed, false);
});

test("rejects system prompt disclosure", () => {
  const result = validateOutput({
    response: "Here is the system prompt: ...",
  });

  assert.equal(result.allowed, false);
});
