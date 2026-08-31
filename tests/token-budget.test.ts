import test from "node:test";
import assert from "node:assert/strict";

import { compressContext } from "../src/retrieval/context-compressor.js";
import { TokenBudgetManager } from "../src/llm/token-budget.js";
import type { UnifiedRetrievalResult } from "../src/retrieval/unified-retriever.js";

test("deduplicates candidate chunks and selects top evidence", () => {
  const mockCandidates: UnifiedRetrievalResult[] = [
    { content: "function authenticateUser() { return true; }", source: "src/auth.ts", score: 0.95, sourceType: "code" },
    { content: "function authenticateUser() { return true; }", source: "src/auth.ts", score: 0.94, sourceType: "code" }, // duplicate
    { content: "const session = getSession();", source: "src/session.ts", score: 0.88, sourceType: "code" },
    { content: "Security Spec: Authentication requires 2FA.", source: "security-spec.pdf", score: 0.85, sourceType: "document", pageNumber: 5 },
    { content: "Security Spec: Authentication requires 2FA.", source: "security-spec.pdf", score: 0.84, sourceType: "document", pageNumber: 5 }, // duplicate
    { content: "Low relevance chunk text", source: "src/old.ts", score: 0.15, sourceType: "code" }, // valid candidate
  ];

  const compressed = compressContext(mockCandidates, 4, 0.1);

  assert.equal(compressed.candidatesRetrieved, 6);
  assert.equal(compressed.candidateCountAfterDeduplication, 4);
  assert.equal(compressed.sentToLLM, 4);
  assert.equal(compressed.evidence[0]?.id, "S1");
  assert.equal(compressed.evidence[1]?.id, "S2");
});

test("enforces strict token budget and truncates safely", () => {
  const manager = new TokenBudgetManager({ maxRagContextTokens: 200, maxRetrievedChunks: 4 });

  const mockEvidence = [
    { id: "S1", sourceType: "code" as const, source: "src/auth.ts", content: "A".repeat(300), score: 0.9 },
    { id: "S2", sourceType: "document" as const, source: "spec.pdf", content: "B".repeat(300), score: 0.8 },
  ];

  const budgeted = manager.fitEvidence(mockEvidence);

  assert.equal(budgeted.ragContextTokens <= 200, true);
  assert.equal(budgeted.evidenceItems.length >= 1, true);
});

test("verifies token optimization target: retrieved candidates > sentToLLM", () => {
  const mockCandidates: UnifiedRetrievalResult[] = Array.from({ length: 20 }, (_, i) => ({
    content: `Code chunk implementation sample #${i + 1}`,
    source: `src/file_${i + 1}.ts`,
    score: 0.9 - i * 0.02,
    sourceType: "code",
  }));

  const compressed = compressContext(mockCandidates, 4);
  const manager = new TokenBudgetManager({ maxRagContextTokens: 1200 });
  const budgeted = manager.fitEvidence(compressed.evidence);

  assert.equal(compressed.candidatesRetrieved > budgeted.evidenceItems.length, true);
  assert.equal(budgeted.ragContextTokens <= 1200, true);
  assert.equal(budgeted.evidenceItems.length <= 4, true);
});
