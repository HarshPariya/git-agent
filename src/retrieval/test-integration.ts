import { CodeRetriever } from "./retriever.js";
import { validateQueryLength, ResourceLimitError } from "../guardrails/retrieval-limits.js";
import { loadGraphCache, saveGraphCache } from "../graph/graph-cache.js";
import { metricsCollector } from "../monitoring/observability.js";
import { closeDatabase } from "../db/postgres.js";

const runIntegrationTests = async (): Promise<void> => {
  console.log(
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nFULL INTEGRATION & HARDENING TEST SUITE\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n",
  );

  let passed = 0;
  let failed = 0;

  const assert = (condition: boolean, name: string): void => {
    console.log(condition ? `✓ [PASS] ${name}` : `❌ [FAIL] ${name}`);
    condition ? ++passed : ++failed;
  };

  try {
    validateQueryLength("a".repeat(2500));
    assert(false, "Failed to reject oversized query");
  } catch (err) {
    assert(err instanceof ResourceLimitError, "Input limits correctly rejected 2,500 character query");
  }

  const testCachePath = "scratch/test_invalid_cache.json";
  await saveGraphCache({ repositoryHash: "test-hash", entities: [], relationships: [] }, testCachePath);
  const loadedCache = await loadGraphCache(testCachePath);
  assert(loadedCache !== null, "Successfully loaded valid graph cache v2.0.0");

  const retriever = new CodeRetriever(process.cwd(), "ai-chatbot");
  await retriever.initialize();
  const results = await retriever.retrieve("Where is normalizeId used?");
  assert(results.length > 0, "Retriever returned ranked results");

  const systemMetrics = metricsCollector.getMetrics();
  assert(systemMetrics.retrieval.totalRequests > 0, "Observability metrics tracked retrieval request count");
  assert(systemMetrics.retrieval.avgLatencyMs >= 0, "Observability metrics tracked average retrieval latency");

  await closeDatabase();

  console.log(
    `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nINTEGRATION TEST RESULTS: ${passed} Passed, ${failed} Failed.\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
  );

  if (failed > 0) process.exitCode = 1;
};

runIntegrationTests().catch((err: unknown) => {
  console.error("Integration test failed:", err);
  process.exitCode = 1;
});
