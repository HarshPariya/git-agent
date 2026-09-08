import {
  validateQueryLength, validateTopK, validateChunkContentSize,
  validateRepositoryScan, validateRepositoryChunkCount, validateGraphDepth, ResourceLimitError,
} from "./retrieval-limits.js";
import { CodeRetriever } from "../retrieval/retriever.js";
import { closeDatabase } from "../db/postgres.js";

async function runResourceLimitTests() {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("RESOURCE LIMIT & BOUNDARY TEST SUITE");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  let passed = 0, failed = 0;
  const assert = (condition: boolean, testName: string) => {
    console.log(condition ? `✓ [PASS] ${testName}` : `❌ [FAIL] ${testName}`);
    condition ? passed++ : failed++;
  };

  const expectThrow = async (fn: () => unknown, testName: string) => {
    try { fn(); assert(false, testName); } catch (err) { assert(err instanceof ResourceLimitError, testName); }
  };

  // Query Length
  assert(validateQueryLength("Where is normalizeId used?") === "Where is normalizeId used?", "Normal query accepted");
  await expectThrow(() => validateQueryLength("a".repeat(2001)), "2001-character query rejected");

  // Result Limits
  assert(validateTopK(10) === 10, "topK=10 accepted");
  await expectThrow(() => validateTopK(51), "topK=51 rejected");
  await expectThrow(() => validateTopK(-5), "Invalid negative topK rejected");
  await expectThrow(() => validateTopK(Number.NaN), "NaN / non-integer limits rejected");

  // Chunk Content Size
  assert(Buffer.byteLength(validateChunkContentSize("b".repeat(40000)), "utf8") <= 32768, "Oversized chunk content safely bounded to 32 KB");

  // Repository Scan Limits
  await expectThrow(() => validateRepositoryScan(10001, 100), "Repository file-count limit enforced");
  await expectThrow(() => validateRepositoryScan(500, 600 * 1024 * 1024), "Repository size limit enforced");

  // Repository Chunk Count
  await expectThrow(() => validateRepositoryChunkCount(100001), "Repository chunk-count limit enforced");

  // Graph Depth
  assert(validateGraphDepth(10) <= 5, "Graph depth limit enforced (clamped to max 5)");

  // End-to-End Retriever Pipeline
  const retriever = new CodeRetriever(process.cwd(), "ai-chatbot");
  await retriever.initialize();
  await expectThrow(() => retriever.retrieve("Where is normalizeId used?", { limit: 100 }), "CodeRetriever rejected limit=100 bypassing API layer");

  await closeDatabase();
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`RESOURCE LIMIT TEST RESULTS: ${passed} Passed, ${failed} Failed.`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  if (failed > 0) process.exitCode = 1;
}

runResourceLimitTests().catch((err) => { console.error("Resource limit test failed:", err); process.exitCode = 1; });
