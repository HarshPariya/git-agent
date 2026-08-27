import {
  validateQueryLength,
  validateTopK,
  validateChunkContentSize,
  validateRepositoryScan,
  validateRepositoryChunkCount,
  validateGraphDepth,
  ResourceLimitError,
} from "./retrieval-limits.js";
import { CodeRetriever } from "../retrieval/retriever.js";
import { closeDatabase } from "../db/postgres.js";

async function runResourceLimitTests() {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("RESOURCE LIMIT & BOUNDARY TEST SUITE");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log();

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string) {
    if (condition) {
      console.log(`✓ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${testName}`);
      failed++;
    }
  }

  // 1. Query Length Limits
  try {
    const valid = validateQueryLength("Where is normalizeId used?");
    assert(valid === "Where is normalizeId used?", "Normal query accepted");
  } catch {
    assert(false, "Normal query accepted");
  }

  try {
    const hugeQuery = "a".repeat(2001);
    validateQueryLength(hugeQuery);
    assert(false, "2001-character query rejected");
  } catch (err) {
    assert(err instanceof ResourceLimitError, "2001-character query rejected");
  }

  // 2. Result Limit (topK) Guardrails
  try {
    const topK10 = validateTopK(10);
    assert(topK10 === 10, "topK=10 accepted");
  } catch {
    assert(false, "topK=10 accepted");
  }

  try {
    validateTopK(51);
    assert(false, "topK=51 rejected");
  } catch (err) {
    assert(err instanceof ResourceLimitError, "topK=51 rejected");
  }

  try {
    validateTopK(-5);
    assert(false, "Invalid negative topK rejected");
  } catch (err) {
    assert(err instanceof ResourceLimitError, "Invalid negative topK rejected");
  }

  try {
    validateTopK(Number.NaN);
    assert(false, "NaN / non-integer limits rejected");
  } catch (err) {
    assert(err instanceof ResourceLimitError, "NaN / non-integer limits rejected");
  }

  // 3. Chunk Content Size Limit
  const oversizedChunk = "b".repeat(40000);
  const truncatedChunk = validateChunkContentSize(oversizedChunk);
  assert(
    Buffer.byteLength(truncatedChunk, "utf8") <= 32768,
    "Oversized chunk content safely bounded to 32 KB",
  );

  // 4. Repository Scan Limits
  try {
    validateRepositoryScan(10001, 100);
    assert(false, "Repository file-count limit enforced");
  } catch (err) {
    assert(err instanceof ResourceLimitError, "Repository file-count limit enforced");
  }

  try {
    validateRepositoryScan(500, 600 * 1024 * 1024);
    assert(false, "Repository size limit enforced");
  } catch (err) {
    assert(err instanceof ResourceLimitError, "Repository size limit enforced");
  }

  // 5. Repository Chunk Count Limit
  try {
    validateRepositoryChunkCount(100001);
    assert(false, "Repository chunk-count limit enforced");
  } catch (err) {
    assert(err instanceof ResourceLimitError, "Repository chunk-count limit enforced");
  }

  // 6. Graph Depth Bounding
  const depth = validateGraphDepth(10);
  assert(depth <= 5, "Graph depth limit enforced (clamped to max 5)");

  // 7. End-to-End Retriever Pipeline Integration Guardrail
  const retriever = new CodeRetriever(process.cwd(), "ai-chatbot");
  await retriever.initialize();

  try {
    await retriever.retrieve("Where is normalizeId used?", { limit: 100 });
    assert(false, "CodeRetriever rejected limit=100 bypassing API layer");
  } catch (err) {
    assert(err instanceof ResourceLimitError, "CodeRetriever rejected limit=100 bypassing API layer");
  }

  await closeDatabase();

  console.log();
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`RESOURCE LIMIT TEST RESULTS: ${passed} Passed, ${failed} Failed.`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  if (failed > 0) {
    process.exitCode = 1;
  }
}

runResourceLimitTests().catch((err) => {
  console.error("Resource limit test failed:", err);
  process.exitCode = 1;
});
