import {
  parseRepository,
} from "../ingestion/parser.js";

import {
  chunkRepository,
} from "../ingestion/chunker.js";

import {
  buildVectorIndex,
  vectorSearch,
} from "./vector-search.js";

async function main() {
  console.log(
    "🧠 Building vector retrieval index...",
  );

  console.log();

  const parsedFiles =
    await parseRepository(
      process.cwd(),
    );

  const chunks =
    chunkRepository(
      parsedFiles,
    );

  console.log(
    `✓ Chunks: ${chunks.length}`,
  );

  console.log(
    "Generating embeddings...",
  );

  const index =
    await buildVectorIndex(
      chunks,
    );

  console.log(
    `✓ Embedded chunks: ${index.length}`,
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
    `Query: "${query}"`,
  );

  console.log(
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
  );

  console.log();

  const results =
    await vectorSearch(
      query,
      index,
      10,
    );

  results.forEach(
    (result, index) => {
      console.log(
        `${index + 1}. ${result.chunk.type.toUpperCase()} — ${result.chunk.name}`,
      );

      console.log(
        `   Score: ${result.score.toFixed(4)}`,
      );

      console.log(
        `   File: ${result.chunk.filePath}`,
      );

      console.log(
        `   Lines: ${result.chunk.startLine}-${result.chunk.endLine}`,
      );

      console.log();
    },
  );
}

main().catch((error) => {
  console.error(
    "Vector search failed:",
  );

  console.error(error);

  process.exit(1);
});
