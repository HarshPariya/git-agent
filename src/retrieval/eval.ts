import {
  performance,
} from "node:perf_hooks";

import {
  CodeRetriever,
} from "./retriever.js";

import {
  retrievalEvalDataset,
} from "./eval-dataset.js";

import {
  closeDatabase,
} from "../db/postgres.js";

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

function findFirstRelevantRank(
  returned: string[],
  expected: string[],
): number | null {
  for (
    let index = 0;
    index < returned.length;
    index++
  ) {
    const item = returned[index];
    if (
      item !== undefined &&
      expected.includes(
        item,
      )
    ) {
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
  const topK =
    returned.slice(0, k);

  const relevantFound =
    expected.filter(
      (name) =>
        topK.includes(name),
    );

  return (
    relevantFound.length /
    expected.length
  );
}

async function main() {
  console.log(
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
  );

  console.log(
    "RETRIEVAL EVALUATION",
  );

  console.log(
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
  );

  console.log();

  const retriever =
    new CodeRetriever(
      process.cwd(),
    );

  await retriever.initialize();

  const results: EvalCaseResult[] = [];

  for (
    const testCase
    of retrievalEvalDataset
  ) {
    const start =
      performance.now();

    const retrieved =
      await retriever.retrieve(
        testCase.query,
        {
          limit: 10,
        },
      );

    const latencyMs =
      performance.now() -
      start;

    const returned =
      retrieved.map(
        (result) =>
          result.name,
      );

    const rank =
      findFirstRelevantRank(
        returned,
        testCase.expectedNames,
      );

    const recallAt1 =
      calculateRecallAtK(
        returned,
        testCase.expectedNames,
        1,
      );

    const recallAt5 =
      calculateRecallAtK(
        returned,
        testCase.expectedNames,
        5,
      );

    const reciprocalRank =
      rank
        ? 1 / rank
        : 0;

    results.push({
      id:
        testCase.id,

      query:
        testCase.query,

      expected:
        testCase.expectedNames,

      returned,

      rank,

      recallAt1,
      recallAt5,

      reciprocalRank,

      latencyMs,
    });

    console.log(
      `${rank ? "✓" : "✗"} ${testCase.id}`,
    );

    console.log(
      `  Query: ${testCase.query}`,
    );

    console.log(
      `  Expected: ${testCase.expectedNames.join(", ")}`,
    );

    console.log(
      `  Top result: ${returned[0] ?? "none"}`,
    );

    console.log(
      `  First relevant rank: ${rank ?? "not found"}`,
    );

    console.log(
      `  Latency: ${latencyMs.toFixed(1)} ms`,
    );

    console.log();
  }

  const count =
    results.length;

  const meanRecallAt1 =
    results.reduce(
      (sum, result) =>
        sum +
        result.recallAt1,
      0,
    ) / count;

  const meanRecallAt5 =
    results.reduce(
      (sum, result) =>
        sum +
        result.recallAt5,
      0,
    ) / count;

  const mrr =
    results.reduce(
      (sum, result) =>
        sum +
        result.reciprocalRank,
      0,
    ) / count;

  const meanLatency =
    results.reduce(
      (sum, result) =>
        sum +
        result.latencyMs,
      0,
    ) / count;

  const sortedLatency =
    results
      .map(
        (result) =>
          result.latencyMs,
      )
      .sort(
        (a, b) =>
          a - b,
      );

  const p95Index =
    Math.min(
      sortedLatency.length - 1,
      Math.floor(
        sortedLatency.length *
          0.95,
      ),
    );

  const p95Latency =
    sortedLatency[p95Index] ?? 0;

  console.log(
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
  );

  console.log(
    "EVALUATION SUMMARY",
  );

  console.log(
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
  );

  console.log();

  console.log(
    `Queries: ${count}`,
  );

  console.log(
    `Recall@1: ${(meanRecallAt1 * 100).toFixed(1)}%`,
  );

  console.log(
    `Recall@5: ${(meanRecallAt5 * 100).toFixed(1)}%`,
  );

  console.log(
    `MRR: ${mrr.toFixed(3)}`,
  );

  console.log(
    `Mean latency: ${meanLatency.toFixed(1)} ms`,
  );

  console.log(
    `P95 latency: ${p95Latency.toFixed(1)} ms`,
  );
}

main()
  .catch((error) => {
    console.error(
      "Retrieval evaluation failed:",
    );

    console.error(error);

    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabase();
  });
