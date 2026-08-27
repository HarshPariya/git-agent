import { CodeRetriever } from "../retrieval/retriever.js";
import { analyzeImpact } from "./impact-analysis.js";
import { explainRetrievedContext } from "../retrieval/explainable-search.js";
import { closeDatabase } from "../db/postgres.js";

async function runImpactAnalysisTest() {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("IMPACT ANALYSIS & EXPLAINABLE RAG TEST");
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

  const retriever = new CodeRetriever(process.cwd(), "ai-chatbot");
  await retriever.initialize();

  // Access private graph via stats / retriever
  const graph = (retriever as any).graph;

  try {
    // 1. Impact Analysis for 'traverseGraph'
    console.log("1. Running Impact Analysis on 'traverseGraph'...");
    const report = analyzeImpact("traverseGraph", graph);

    console.log();
    console.log(report.explanation);
    console.log();

    assert(report.target.name === "traverseGraph", "Found target symbol traverseGraph");
    assert(report.totalDependentsCount > 0, "Identified downstream dependents");
    assert(["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(report.riskLevel), "Calculated valid Risk Level");

    // 2. Explainable Search
    console.log("2. Running Explainable RAG Search...");
    const results = await retriever.retrieve("Where is normalizeId used?");
    assert(results.length > 0, "Retrieved search results");

    const explained = explainRetrievedContext(results[0], "normalizeId");
    console.log();
    console.log("💡 Explained Result #1:", explained.explanation);
    console.log();

    assert(explained.explanation.relevanceReasons.length > 0, "Generated structured relevance explanations");

  } finally {
    await closeDatabase();
  }

  console.log();
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`IMPACT ANALYSIS TEST RESULTS: ${passed} Passed, ${failed} Failed.`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  if (failed > 0) {
    process.exitCode = 1;
  }
}

runImpactAnalysisTest().catch((err) => {
  console.error("Impact Analysis test failed:", err);
  process.exitCode = 1;
});
