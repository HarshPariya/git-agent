import {
  CodeRetriever,
} from "./retriever.js";
import {
  closeDatabase,
} from "../db/postgres.js";

async function main() {
  const retriever =
    new CodeRetriever(
      process.cwd(),
    );

  await retriever.initialize();

  const stats =
    retriever.getStats();

  console.log();
  console.log(
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
  );

  console.log(
    "RETRIEVER STATS",
  );

  console.log(
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
  );

  console.log(
    `Files: ${stats.files}`,
  );

  console.log(
    `Chunks: ${stats.chunks}`,
  );

  console.log(
    `Graph nodes: ${stats.graphNodes}`,
  );

  console.log(
    `Graph edges: ${stats.graphEdges}`,
  );

  const query =
    process.argv
      .slice(2)
      .join(" ") ||
    "Where is normalizeId used?";

  console.log();
  console.log(
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
  );

  console.log(
    `QUERY: "${query}"`,
  );

  console.log(
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
  );

  console.log();

  const results =
    await retriever.retrieve(
      query,
      {
        limit: 8,
      },
    );

  for (const result of results) {
    console.log(
      `${result.rank}. ${result.name}`,
    );

    if (
      result.rerankScore !== undefined
    ) {
      console.log(
        `   Rerank: ${result.rerankScore.toFixed(4)}`,
      );
    }

    console.log(
      `   Hybrid Score: ${result.score.toFixed(4)}`,
    );

    console.log(
      `   Vector Score: ${result.vectorScore.toFixed(4)}`,
    );

    console.log(
      `   Graph Score: ${result.graphScore.toFixed(4)}`,
    );

    console.log(
      `   Sources: ${result.sources.join(" + ")}`,
    );

    if (result.filePath) {
      console.log(
        `   File: ${result.filePath}`,
      );
    }

    if (
      result.startLine !== undefined &&
      result.endLine !== undefined
    ) {
      console.log(
        `   Lines: ${result.startLine}-${result.endLine}`,
      );
    }

    console.log();
  }
}

main()
  .catch((error) => {
    console.error(
      "Retriever test failed:",
    );

    console.error(error);

    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabase();
  });
