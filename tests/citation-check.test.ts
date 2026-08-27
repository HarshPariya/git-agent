import test from "node:test";
import assert from "node:assert/strict";

import { verifyCitations } from "../src/guardrails/citation-check.js";

const sources = [
  {
    content: "Refunds are available within 30 days.",
    source: "refund-policy.pdf",
    page: 4,
    score: 0.98,
  },
] as const;

test("accepts a citation matching a retrieved source", () => {
  const result = verifyCitations({
    answer: "Refunds are available within 30 days. [refund-policy.pdf]",
    sources,
  });

  assert.equal(result.valid, true);
});

test("accepts a citation matching source and page", () => {
  const result = verifyCitations({
    answer: "Refunds are available within 30 days. [refund-policy.pdf page 4]",
    sources,
  });

  assert.equal(result.valid, true);
});

test("rejects an answer without citations", () => {
  const result = verifyCitations({
    answer: "Refunds are available within 30 days.",
    sources,
  });

  assert.equal(result.valid, false);
  assert.match(result.reason, /no citations/i);
});

test("rejects an unknown citation", () => {
  const result = verifyCitations({
    answer: "Refunds are available within 30 days. [unknown.pdf]",
    sources,
  });

  assert.equal(result.valid, false);
  assert.match(result.reason, /does not match/i);
});
