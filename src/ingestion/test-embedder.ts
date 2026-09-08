import { embedText, getEmbeddingMetrics } from "./embedder.js";

const runEmbedderTests = async () => {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nEMBEDDING RESILIENCE & METRICS TESTS\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  let passed = 0;
  let failed = 0;
  const assert = (ok: boolean, name: string) => {
    console.log(ok ? `✓ [PASS] ${name}` : `❌ [FAIL] ${name}`);
    ok ? passed++ : failed++;
  };

  try {
    // 1. Single Embedding
    console.log("1. Testing single text embedding...");
    const vector = await embedText("function normalizeId() {}");
    assert(Array.isArray(vector) && vector.length === 384, "Generated valid 384-dimensional vector");

    // 2. Concurrent Deduplication
    console.log("2. Testing concurrent embedding requests (promise locking)...");
    const results = await Promise.all([
      embedText("const x = 1;"),
      embedText("class CodeRetriever {}"),
      embedText("export async function search() {}"),
    ]);
    assert(
      results.length === 3 && results.every((v) => v.length === 384),
      "Concurrent embedding promises resolved successfully",
    );

    // 3. Metrics
    const stats = getEmbeddingMetrics();
    console.log("\nEmbedding Engine Metrics:", stats);
    assert(stats.totalEmbeddings >= 4, "Tracked total embeddings generated");
    assert(stats.failedEmbeddings === 0, "Zero embedding failures in normal run");
    assert(stats.modelLoadTimeMs >= 0, "Recorded model load latency");
  } catch (err: unknown) {
    console.error("Embedder test crashed:", err instanceof Error ? err.message : err);
    failed++;
  } finally {
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nEMBEDDER TEST RESULTS: ${passed} Passed, ${failed} Failed.\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    if (failed > 0) process.exitCode = 1;
  }
};

runEmbedderTests().catch((err) => {
  console.error("Embedder test failed:", err);
  process.exitCode = 1;
});
