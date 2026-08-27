import {
  embedText,
  getEmbeddingMetrics,
  EmbeddingError,
} from "./embedder.js";

async function runEmbedderTests() {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("EMBEDDING RESILIENCE & METRICS TESTS");
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

  // 1. Single Embedding Generation
  console.log("1. Testing single text embedding...");
  const vector1 = await embedText("function normalizeId() {}");
  assert(
    Array.isArray(vector1) && vector1.length === 384,
    "Generated valid 384-dimensional vector",
  );

  // 2. Concurrent Execution Deduplication
  console.log("2. Testing concurrent embedding requests (promise locking)...");
  const promises = [
    embedText("const x = 1;"),
    embedText("class CodeRetriever {}"),
    embedText("export async function search() {}"),
  ];

  const results = await Promise.all(promises);
  assert(
    results.length === 3 && results.every((v) => v.length === 384),
    "Concurrent embedding promises resolved successfully",
  );

  // 3. Metrics Validation
  const stats = getEmbeddingMetrics();
  console.log();
  console.log("📊 Embedding Engine Metrics:", stats);

  assert(stats.totalEmbeddings >= 4, "Tracked total embeddings generated");
  assert(stats.failedEmbeddings === 0, "Zero embedding failures in normal run");
  assert(stats.modelLoadTimeMs >= 0, "Recorded model load latency");

  console.log();
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`EMBEDDER TEST RESULTS: ${passed} Passed, ${failed} Failed.`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  if (failed > 0) {
    process.exitCode = 1;
  }
}

runEmbedderTests().catch((err) => {
  console.error("Embedder test failed:", err);
  process.exitCode = 1;
});
