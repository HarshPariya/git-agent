import { performance } from "node:perf_hooks";
import { CodeRetriever } from "./retriever.js";
import { retrievalEvalDataset } from "./eval-dataset.js";
import { closeDatabase } from "../db/mongodb.js";

interface EvalCaseResult {
  id: string;
  query: string;
  expected: string[];
  returned: string[];
  rank: number | null;
  recallAt1: number;
  recallAt5: number;
  reciprocalRank: number;
  latencyMs: number;
}

const findFirstRelevantRank = (returned: string[], expected: string[]): number | null => {
  const idx = returned.findIndex((item) => item !== undefined && expected.includes(item));
  return idx >= 0 ? idx + 1 : null;
};

const calculateRecallAtK = (returned: string[], expected: string[], k: number): number =>
  expected.filter((n) => returned.slice(0, k).includes(n)).length / expected.length;

const evaluateCase = async (
  retriever: CodeRetriever,
  tc: (typeof retrievalEvalDataset)[number],
): Promise<EvalCaseResult> => {
  const start = performance.now();
  const retrieved = await retriever.retrieve(tc.query, { limit: 10 });
  const latencyMs = performance.now() - start;
  const returned = retrieved.map((r) => r.name);
  const rank = findFirstRelevantRank(returned, tc.expectedNames);

  return {
    id: tc.id,
    query: tc.query,
    expected: tc.expectedNames,
    returned,
    rank,
    recallAt1: calculateRecallAtK(returned, tc.expectedNames, 1),
    recallAt5: calculateRecallAtK(returned, tc.expectedNames, 5),
    reciprocalRank: rank ? 1 / rank : 0,
    latencyMs,
  };
};

const printCaseResult = ({ id, query, expected, returned, rank, latencyMs }: EvalCaseResult): void => {
  const indicator = rank ? "✓" : "✗";
  const topResult = returned[0] ?? "none";
  const firstRelevant = rank ?? "not found";
  console.warn(
    `${indicator} ${id}\n` +
      `  Query: ${query}\n` +
      `  Expected: ${expected.join(", ")}\n` +
      `  Top result: ${topResult}\n` +
      `  First relevant rank: ${firstRelevant}\n` +
      `  Latency: ${latencyMs.toFixed(1)} ms\n`,
  );
};

const printSummary = (results: EvalCaseResult[]): void => {
  const avg = (fn: (r: EvalCaseResult) => number) => results.reduce((s, r) => s + fn(r), 0) / results.length;
  const sortedLatency = results.map((r) => r.latencyMs).sort((a, b) => a - b);
  const p95Idx = Math.min(sortedLatency.length - 1, Math.floor(sortedLatency.length * 0.95));

  console.warn(
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nEVALUATION SUMMARY\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
      `Queries: ${results.length}\n` +
      `Recall@1: ${(avg((r) => r.recallAt1) * 100).toFixed(1)}%\n` +
      `Recall@5: ${(avg((r) => r.recallAt5) * 100).toFixed(1)}%\n` +
      `MRR: ${avg((r) => r.reciprocalRank).toFixed(3)}\n` +
      `Mean latency: ${avg((r) => r.latencyMs).toFixed(1)} ms\n` +
      `P95 latency: ${(sortedLatency[p95Idx] ?? 0).toFixed(1)} ms`,
  );
};

const main = async (): Promise<void> => {
  console.warn("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nRETRIEVAL EVALUATION\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const retriever = new CodeRetriever(process.cwd());
  await retriever.initialize();

  const results = await Promise.all(retrievalEvalDataset.map((tc) => evaluateCase(retriever, tc)));
  results.forEach(printCaseResult);
  printSummary(results);
};

main()
  .catch((err: unknown) => {
    console.error("Retrieval evaluation failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabase();
  });
