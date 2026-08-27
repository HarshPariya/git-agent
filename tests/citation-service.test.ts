import test from "node:test";
import assert from "node:assert/strict";

import { verifyAnswerCitations } from "../src/services/citation-service.js";

const sources = [
  {
    content: "Refunds are available within 30 days.",
    source: "refund-policy.pdf",
    page: 4,
    score: 0.98,
  },
] as const;

test("validates citations against retrieved sources", () => {
  const result = verifyAnswerCitations(
    "Refunds are available within 30 days. [refund-policy.pdf page 4]",
    sources,
  );

  assert.equal(result.valid, true);
});

test("rejects unsupported citations", () => {
  const result = verifyAnswerCitations(
    "Refunds are available within 30 days. [unknown.pdf]",
    sources,
  );

  assert.equal(result.valid, false);
});
