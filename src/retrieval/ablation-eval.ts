import { performance } from "node:perf_hooks";
import { CodeRetriever } from "./retriever.js";
import { retrievalEvalDataset } from "./eval-dataset.js";
import { pgVectorSearch } from "../db/vector-store.js";
import { graphSearch } from "./graph-search.js";
import { hybridSearch } from "./hybrid-search.js";
import { closeDatabase } from "../db/postgres.js";

interface ModeMetrics { modeName: string; recallAt1: number; recallAt5: number; mrr: number; meanLatencyMs: number; p95LatencyMs: number; }
function findFirstRelevantRank(returned: string[], expected: string[]): number | null {
  for (let i = 0; i < returned.length; i++) { const item = returned[i]; if (item !== undefined && expected.includes(item)) return i + 1; }
  return null;
}
function calculateRecallAtK(returned: string[], expected: string[], k: number): number {
  const topK = returned.slice(0, k);
  return expected.filter((n) => topK.includes(n)).length / expected.length;
}

async function main() {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nRETRIEVAL ABLATION BENCHMARK\nComparing: Vector Only | Graph Only | Hybrid | Hybrid + Reranker\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  const retriever = new CodeRetriever(process.cwd());
  await retriever.initialize();
  const graph = (retriever as any).graph;
  const chunks = (retriever as any).chunks;

  const modes: { name: string; run: (query: string) => Promise<string[]> }[] = [
    { name: "Vector Only", run: async (q) => (await pgVectorSearch(q, { repository: "ai-chatbot", limit: 10 })).map((r) => r.chunk.name ?? r.chunk.filePath) },
    { name: "Graph Only", run: async (q) => graphSearch(graph, q, { limit: 10 }).map((r) => r.entity.name) },
    { name: "Hybrid", run: async (q) => { const v = await pgVectorSearch(q, { repository: "ai-chatbot", limit: 15 }); return (await hybridSearch(q, graph, chunks, v, { limit: 10 })).map((r) => r.name); } },
    { name: "Hybrid + Reranker", run: async (q) => (await retriever.retrieve(q, { limit: 10 })).map((r) => r.name) },
  ];

  const summaryMetrics: ModeMetrics[] = [];
  for (const mode of modes) {
    console.log(`Evaluating Mode: ${mode.name}...`);
    const caseResults: { recallAt1: number; recallAt5: number; reciprocalRank: number; latencyMs: number }[] = [];
    for (const tc of retrievalEvalDataset) {
      const start = performance.now();
      const returned = await mode.run(tc.query);
      const latencyMs = performance.now() - start;
      const rank = findFirstRelevantRank(returned, tc.expectedNames);
      caseResults.push({ recallAt1: calculateRecallAtK(returned, tc.expectedNames, 1), recallAt5: calculateRecallAtK(returned, tc.expectedNames, 5), reciprocalRank: rank ? 1 / rank : 0, latencyMs });
    }
    const count = caseResults.length;
    const avg = (fn: (r: typeof caseResults[0]) => number) => caseResults.reduce((s, r) => s + fn(r), 0) / count;
    const sortedLatency = caseResults.map((r) => r.latencyMs).sort((a, b) => a - b);
    summaryMetrics.push({
      modeName: mode.name, recallAt1: avg((r) => r.recallAt1), recallAt5: avg((r) => r.recallAt5), mrr: avg((r) => r.reciprocalRank), meanLatencyMs: avg((r) => r.latencyMs),
      p95LatencyMs: sortedLatency[Math.min(sortedLatency.length - 1, Math.floor(sortedLatency.length * 0.95))] ?? 0,
    });
  }

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nABLATION COMPARISON MATRIX\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  console.log("Mode".padEnd(20) + "Recall@1".padEnd(12) + "Recall@5".padEnd(12) + "MRR".padEnd(10) + "Mean Latency".padEnd(15) + "P95 Latency");
  console.log("-".repeat(80));
  for (const m of summaryMetrics) {
    console.log(`${m.modeName.padEnd(20)}${(m.recallAt1 * 100).toFixed(1)}%`.padEnd(32) + `${(m.recallAt5 * 100).toFixed(1)}%`.padEnd(12) + m.mrr.toFixed(3).padEnd(10) + `${m.meanLatencyMs.toFixed(1)} ms`.padEnd(15) + `${m.p95LatencyMs.toFixed(1)} ms`);
  }
  console.log();
}

main().catch((err) => { console.error("Ablation evaluation failed:", err); process.exitCode = 1; }).finally(async () => { await closeDatabase(); });
