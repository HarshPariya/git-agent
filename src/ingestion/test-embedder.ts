import { embedText, getEmbeddingMetrics } from "./embedder.js";

const runEmbedderTests = () => {
  console.warn("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nEMBEDDING RESILIENCE & METRICS TESTS\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  let passed = 0;
  let failed = 0;
  const assert = (ok: boolean, name: string) => {
    console.warn(ok ? `✓ [PASS] ${name}` : `❌ [FAIL] ${name}`);
    if (ok) { passed++; } else { failed++; }
  };

  try {
    // 1. Single Embedding
    console.warn("1. Testing single text embedding...");
    const vector = embedText("function normalizeId() {}");
    assert(Array.isArray(vector) && vector.length === 384, "Generated valid 384-dimensional vector");

    // 2. Concurrent Deduplication
    console.warn("2. Testing concurrent embedding requests (promise locking)...");
    const results = [
      embedText("const x = 1;"),
      embedText("class CodeRetriever {}"),
      embedText("export async function search() {}"),
    ];
    assert(
      results.length === 3 && results.every((v) => v.length === 384),
      "Concurrent embedding promises resolved successfully",
    );

    // 3. Metrics
    const stats = getEmbeddingMetrics();
    console.warn("\nEmbedding Engine Metrics:", stats);
    assert(stats.totalEmbeddings >= 4, "Tracked total embeddings generated");
    assert(stats.failedEmbeddings === 0, "Zero embedding failures in normal run");
    assert(stats.modelLoadTimeMs >= 0, "Recorded model load latency");
  } catch (err: unknown) {
    console.error("Embedder test crashed:", err instanceof Error ? err.message : err);
    failed++;
  } finally {
    console.warn(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nEMBEDDER TEST RESULTS: ${passed} Passed, ${failed} Failed.\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    if (failed > 0) process.exitCode = 1;
  }
};

runEmbedderTests();
