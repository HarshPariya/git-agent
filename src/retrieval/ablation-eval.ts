import { performance } from "node:perf_hooks";
import { CodeRetriever } from "./retriever.js";
import { retrievalEvalDataset } from "./eval-dataset.js";
import { pgVectorSearch } from "../db/vector-store.js";
import { graphSearch } from "./graph-search.js";
import { hybridSearch } from "./hybrid-search.js";
import { closeDatabase } from "../db/mongodb.js";
import type { CodeChunk } from "../ingestion/chunker.js";
import type { CodeGraph } from "../graph/graph-builder.js";

interface ModeMetrics {
  modeName: string;
  recallAt1: number;
  recallAt5: number;
  mrr: number;
  meanLatencyMs: number;
  p95LatencyMs: number;
}

interface CaseResult {
  recallAt1: number;
  recallAt5: number;
  reciprocalRank: number;
  latencyMs: number;
}

interface ModeConfig {
  name: string;
  run: (query: string) => Promise<string[]>;
}

interface RetrieverInternals {
  graph: CodeGraph;
  chunks: CodeChunk[];
}

const findFirstRelevantRank = (returned: string[], expected: string[]): number | null => {
  const idx = returned.findIndex((item) => item !== undefined && expected.includes(item));
  return idx >= 0 ? idx + 1 : null;
};

const calculateRecallAtK = (returned: string[], expected: string[], k: number): number =>
  expected.filter((n) => returned.slice(0, k).includes(n)).length / expected.length;

const buildModes = (retriever: CodeRetriever, internals: RetrieverInternals): ModeConfig[] => [
  {
    name: "Vector Only",
    run: async (q) =>
      (await pgVectorSearch(q, { repository: "ai-chatbot", limit: 10 })).map((r) => r.chunk.name ?? r.chunk.filePath),
  },
  {
    name: "Graph Only",
    run: (q) => Promise.resolve(graphSearch(internals.graph, q, { limit: 10 }).map((r) => r.entity.name)),
  },
  {
    name: "Hybrid",
    run: async (q) => {
      const v = await pgVectorSearch(q, { repository: "ai-chatbot", limit: 15 });
      return hybridSearch(q, internals.graph, internals.chunks, v, { limit: 10 }).map((r) => r.name);
    },
  },
  {
    name: "Hybrid + Reranker",
    run: async (q) => (await retriever.retrieve(q, { limit: 10 })).map((r) => r.name),
  },
];

const evaluateMode = async (mode: ModeConfig): Promise<ModeMetrics> => {
  console.warn(`Evaluating Mode: ${mode.name}...`);

  const caseResults: CaseResult[] = await Promise.all(
    retrievalEvalDataset.map(async (tc) => {
      const start = performance.now();
      const returned = await mode.run(tc.query);
      const latencyMs = performance.now() - start;
      const rank = findFirstRelevantRank(returned, tc.expectedNames);
      return {
        recallAt1: calculateRecallAtK(returned, tc.expectedNames, 1),
        recallAt5: calculateRecallAtK(returned, tc.expectedNames, 5),
        reciprocalRank: rank ? 1 / rank : 0,
        latencyMs,
      };
    }),
  );

  const avg = (fn: (r: CaseResult) => number) => caseResults.reduce((s, r) => s + fn(r), 0) / caseResults.length;
  const sortedLatency = caseResults.map((r) => r.latencyMs).sort((a, b) => a - b);
  const p95Idx = Math.min(sortedLatency.length - 1, Math.floor(sortedLatency.length * 0.95));

  return {
    modeName: mode.name,
    recallAt1: avg((r) => r.recallAt1),
    recallAt5: avg((r) => r.recallAt5),
    mrr: avg((r) => r.reciprocalRank),
    meanLatencyMs: avg((r) => r.latencyMs),
    p95LatencyMs: sortedLatency[p95Idx] ?? 0,
  };
};

const printResults = (metrics: ModeMetrics[]): void => {
  console.warn(
    "\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
      "ABLATION COMPARISON MATRIX\n" +
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n",
  );
  console.warn(
    "Mode".padEnd(20) +
      "Recall@1".padEnd(12) +
      "Recall@5".padEnd(12) +
      "MRR".padEnd(10) +
      "Mean Latency".padEnd(15) +
      "P95 Latency",
  );
  console.warn("-".repeat(80));

  for (const m of metrics) {
    const r1 = `${(m.recallAt1 * 100).toFixed(1)}%`;
    const r5 = `${(m.recallAt5 * 100).toFixed(1)}%`;
    const ml = `${m.meanLatencyMs.toFixed(1)} ms`;
    const p95 = `${m.p95LatencyMs.toFixed(1)} ms`;
    console.warn(
      `${m.modeName.padEnd(20)}${r1.padEnd(32)}${r5.padEnd(12)}${m.mrr.toFixed(3).padEnd(10)}${ml.padEnd(15)}${p95}`,
    );
  }
  console.warn();
};

const main = async (): Promise<void> => {
  console.warn(
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nRETRIEVAL ABLATION BENCHMARK\n" +
      "Comparing: Vector Only | Graph Only | Hybrid | Hybrid + Reranker\n" +
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n",
  );

  const retriever = new CodeRetriever(process.cwd());
  await retriever.initialize();

  const internals = retriever as unknown as RetrieverInternals;
  const modes = buildModes(retriever, internals);
  const results = await Promise.all(modes.map(evaluateMode));

  printResults(results);
};

main()
  .catch((err: unknown) => {
    console.error("Ablation evaluation failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabase();
  });
