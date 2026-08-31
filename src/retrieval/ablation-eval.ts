import { performance } from "node:perf_hooks";
import { CodeRetriever } from "./retriever.js";
import { retrievalEvalDataset } from "./eval-dataset.js";
import { pgVectorSearch } from "../db/vector-store.js";
import { graphSearch } from "./graph-search.js";
import { hybridSearch } from "./hybrid-search.js";
import { closeDatabase } from "../db/postgres.js";

interface ModeMetrics {
  modeName: string;
  recallAt1: number;
  recallAt5: number;
  mrr: number;
  meanLatencyMs: number;
  p95LatencyMs: number;
}

function findFirstRelevantRank(
  returned: string[],
  expected: string[],
): number | null {
  for (let index = 0; index < returned.length; index++) {
    const item = returned[index];
    if (item !== undefined && expected.includes(item)) {
      return index + 1;
    }
  }
  return null;
}

function calculateRecallAtK(
  returned: string[],
  expected: string[],
  k: number,
): number {
  const topK = returned.slice(0, k);
  const relevantFound = expected.filter((name) => topK.includes(name));
  return relevantFound.length / expected.length;
}

async function main() {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("RETRIEVAL ABLATION BENCHMARK");
  console.log("Comparing: Vector Only | Graph Only | Hybrid | Hybrid + Reranker");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log();

  const retriever = new CodeRetriever(process.cwd());
  await retriever.initialize();

  const graph = (retriever as any).graph;
  const chunks = (retriever as any).chunks;

  const modes: Array<{
    name: string;
    run: (query: string) => Promise<string[]>;
  }> = [
    {
      name: "Vector Only",
      run: async (query) => {
        const vResults = await pgVectorSearch(query, {
          repository: "ai-chatbot",
          limit: 10,
        });
        return vResults.map((r) => r.chunk.name ?? r.chunk.filePath);
      },
    },
    {
      name: "Graph Only",
      run: async (query) => {
        const gResults = graphSearch(graph, query, { limit: 10 });
        return gResults.map((r) => r.entity.name);
      },
    },
    {
      name: "Hybrid",
      run: async (query) => {
        const vResults = await pgVectorSearch(query, {
          repository: "ai-chatbot",
          limit: 15,
        });
        const hResults = await hybridSearch(query, graph, chunks, vResults, {
          limit: 10,
        });
        return hResults.map((r) => r.name);
      },
    },
    {
      name: "Hybrid + Reranker",
      run: async (query) => {
        const rResults = await retriever.retrieve(query, { limit: 10 });
        return rResults.map((r) => r.name);
      },
    },
  ];

  const summaryMetrics: ModeMetrics[] = [];

  for (const mode of modes) {
    console.log(`Evaluating Mode: ${mode.name}...`);

    const caseResults: Array<{
      recallAt1: number;
      recallAt5: number;
      reciprocalRank: number;
      latencyMs: number;
    }> = [];

    for (const testCase of retrievalEvalDataset) {
      const start = performance.now();
      const returned = await mode.run(testCase.query);
      const latencyMs = performance.now() - start;

      const rank = findFirstRelevantRank(returned, testCase.expectedNames);
      const recallAt1 = calculateRecallAtK(
        returned,
        testCase.expectedNames,
        1,
      );
      const recallAt5 = calculateRecallAtK(
        returned,
        testCase.expectedNames,
        5,
      );
      const reciprocalRank = rank ? 1 / rank : 0;

      caseResults.push({
        recallAt1,
        recallAt5,
        reciprocalRank,
        latencyMs,
      });
    }

    const count = caseResults.length;
    const recallAt1 =
      caseResults.reduce((sum, r) => sum + r.recallAt1, 0) / count;
    const recallAt5 =
      caseResults.reduce((sum, r) => sum + r.recallAt5, 0) / count;
    const mrr =
      caseResults.reduce((sum, r) => sum + r.reciprocalRank, 0) / count;
    const meanLatencyMs =
      caseResults.reduce((sum, r) => sum + r.latencyMs, 0) / count;

    const sortedLatency = caseResults
      .map((r) => r.latencyMs)
      .sort((a, b) => a - b);
    const p95Index = Math.min(
      sortedLatency.length - 1,
      Math.floor(sortedLatency.length * 0.95),
    );
    const p95LatencyMs = sortedLatency[p95Index] ?? 0;

    summaryMetrics.push({
      modeName: mode.name,
      recallAt1,
      recallAt5,
      mrr,
      meanLatencyMs,
      p95LatencyMs,
    });
  }

  console.log();
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("ABLATION COMPARISON MATRIX");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log();

  console.log(
    "Mode".padEnd(20) +
      "Recall@1".padEnd(12) +
      "Recall@5".padEnd(12) +
      "MRR".padEnd(10) +
      "Mean Latency".padEnd(15) +
      "P95 Latency",
  );
  console.log("-".repeat(80));

  for (const m of summaryMetrics) {
    console.log(
      m.modeName.padEnd(20) +
        `${(m.recallAt1 * 100).toFixed(1)}%`.padEnd(12) +
        `${(m.recallAt5 * 100).toFixed(1)}%`.padEnd(12) +
        m.mrr.toFixed(3).padEnd(10) +
        `${m.meanLatencyMs.toFixed(1)} ms`.padEnd(15) +
        `${m.p95LatencyMs.toFixed(1)} ms`,
    );
  }

  console.log();
}

main()
  .catch((error) => {
    console.error("Ablation evaluation failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabase();
  });
