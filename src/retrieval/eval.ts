import { performance } from "node:perf_hooks";
import { CodeRetriever } from "./retriever.js";
import { retrievalEvalDataset } from "./eval-dataset.js";
import { closeDatabase } from "../db/postgres.js";

interface EvalCaseResult { id: string; query: string; expected: string[]; returned: string[]; rank: number | null; recallAt1: number; recallAt5: number; reciprocalRank: number; latencyMs: number; }

function findFirstRelevantRank(returned: string[], expected: string[]): number | null {
  for (let i = 0; i < returned.length; i++) { const item = returned[i]; if (item !== undefined && expected.includes(item)) return i + 1; }
  return null;
}
function calculateRecallAtK(returned: string[], expected: string[], k: number): number {
  const topK = returned.slice(0, k);
  return expected.filter((n) => topK.includes(n)).length / expected.length;
}

async function main() {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nRETRIEVAL EVALUATION\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  const retriever = new CodeRetriever(process.cwd());
  await retriever.initialize();
  const results: EvalCaseResult[] = [];

  for (const tc of retrievalEvalDataset) {
    const start = performance.now();
    const retrieved = await retriever.retrieve(tc.query, { limit: 10 });
    const latencyMs = performance.now() - start;
    const returned = retrieved.map((r) => r.name);
    const rank = findFirstRelevantRank(returned, tc.expectedNames);
    const recallAt1 = calculateRecallAtK(returned, tc.expectedNames, 1);
    const recallAt5 = calculateRecallAtK(returned, tc.expectedNames, 5);
    results.push({ id: tc.id, query: tc.query, expected: tc.expectedNames, returned, rank, recallAt1, recallAt5, reciprocalRank: rank ? 1 / rank : 0, latencyMs });
    console.log(`${rank ? "✓" : "✗"} ${tc.id}\n  Query: ${tc.query}\n  Expected: ${tc.expectedNames.join(", ")}\n  Top result: ${returned[0] ?? "none"}\n  First relevant rank: ${rank ?? "not found"}\n  Latency: ${latencyMs.toFixed(1)} ms\n`);
  }

  const count = results.length;
  const avg = (fn: (r: EvalCaseResult) => number) => results.reduce((s, r) => s + fn(r), 0) / count;
  const sortedLatency = results.map((r) => r.latencyMs).sort((a, b) => a - b);
  const p95Latency = sortedLatency[Math.min(sortedLatency.length - 1, Math.floor(sortedLatency.length * 0.95))] ?? 0;

  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nEVALUATION SUMMARY\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nQueries: ${count}\nRecall@1: ${(avg((r) => r.recallAt1) * 100).toFixed(1)}%\nRecall@5: ${(avg((r) => r.recallAt5) * 100).toFixed(1)}%\nMRR: ${avg((r) => r.reciprocalRank).toFixed(3)}\nMean latency: ${avg((r) => r.latencyMs).toFixed(1)} ms\nP95 latency: ${p95Latency.toFixed(1)} ms`);
}

main().catch((err) => { console.error("Retrieval evaluation failed:", err); process.exitCode = 1; }).finally(async () => { await closeDatabase(); });
