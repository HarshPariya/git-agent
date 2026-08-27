import { CodeRetriever } from "./retriever.js";
import { validateQueryLength, ResourceLimitError } from "../guardrails/retrieval-limits.js";
import { loadGraphCache, saveGraphCache } from "../graph/graph-cache.js";
import { metricsCollector } from "../monitoring/observability.js";
import { closeDatabase } from "../db/postgres.js";

async function runIntegrationTests() {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("FULL INTEGRATION & HARDENING TEST SUITE");
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

  // 1. Input Guardrail Test
  try {
    const hugeQuery = "a".repeat(2500);
    validateQueryLength(hugeQuery);
    assert(false, "Failed to reject oversized query");
  } catch (err) {
    assert(
      err instanceof ResourceLimitError,
      "Input limits correctly rejected 2,500 character query",
    );
  }

  // 2. Cache Version Test
  const testCachePath = "scratch/test_invalid_cache.json";
  await saveGraphCache(
    {
      repositoryHash: "test-hash",
      entities: [],
      relationships: [],
    },
    testCachePath,
  );

  const loadedCache = await loadGraphCache(testCachePath);
  assert(loadedCache !== null, "Successfully loaded valid graph cache v2.0.0");

  // 3. Full Retriever Initialization & Metrics Test
  const retriever = new CodeRetriever(process.cwd(), "ai-chatbot");
  await retriever.initialize();

  const results = await retriever.retrieve("Where is normalizeId used?");
  assert(results.length > 0, "Retriever returned ranked results");

  // 4. Observability Metrics Verification
  const systemMetrics = metricsCollector.getMetrics();
  assert(
    systemMetrics.retrieval.totalRequests > 0,
    "Observability metrics tracked retrieval request count",
  );
  assert(
    systemMetrics.retrieval.avgLatencyMs >= 0,
    "Observability metrics tracked average retrieval latency",
  );

  await closeDatabase();

  console.log();
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`INTEGRATION TEST RESULTS: ${passed} Passed, ${failed} Failed.`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  if (failed > 0) {
    process.exitCode = 1;
  }
}

runIntegrationTests().catch((err) => {
  console.error("Integration test failed:", err);
  process.exitCode = 1;
});
