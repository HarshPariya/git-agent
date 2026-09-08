import { parseRepository } from "../ingestion/parser.js";
import { chunkRepository } from "../ingestion/chunker.js";
import { buildVectorIndex, vectorSearch } from "./vector-search.js";

const main = async (): Promise<void> => {
  try {
    console.log("Building vector retrieval index...\n");

    const parsedFiles = await parseRepository(process.cwd());
    const chunks = chunkRepository(parsedFiles);
    console.log(`Chunks: ${chunks.length}\nGenerating embeddings...`);

    const index = await buildVectorIndex(chunks);
    console.log(`Embedded chunks: ${index.length}`);

    const query = process.argv.slice(2).join(" ") || "Where is normalizeId used?";
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nQuery: "${query}"\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    const results = await vectorSearch(query, index, 10);

    for (const [i, result] of results.entries()) {
      console.log(
        `${i + 1}. ${result.chunk.type.toUpperCase()} — ${result.chunk.name}\n` +
          `   Score: ${result.score.toFixed(4)}\n` +
          `   File: ${result.chunk.filePath}\n` +
          `   Lines: ${result.chunk.startLine}-${result.chunk.endLine}\n`,
      );
    }
  } catch (error: unknown) {
    console.error("Vector search failed:", error);
    process.exit(1);
  }
};

main();
