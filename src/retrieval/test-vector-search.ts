import { parseRepository } from "../ingestion/parser.js";
import { chunkRepository } from "../ingestion/chunker.js";
import { buildVectorIndex, vectorSearch } from "./vector-search.js";

async function main() {
  console.log("Building vector retrieval index...\n");

  const parsedFiles = await parseRepository(process.cwd());
  const chunks = chunkRepository(parsedFiles);
  console.log(`Chunks: ${chunks.length}\nGenerating embeddings...`);

  const index = await buildVectorIndex(chunks);
  console.log(`Embedded chunks: ${index.length}`);

  const query = process.argv.slice(2).join(" ") || "Where is normalizeId used?";
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nQuery: "${query}"\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  const results = await vectorSearch(query, index, 10);
  results.forEach((result, index) => {
    console.log(`${index + 1}. ${result.chunk.type.toUpperCase()} — ${result.chunk.name}`);
    console.log(`   Score: ${result.score.toFixed(4)}\n   File: ${result.chunk.filePath}\n   Lines: ${result.chunk.startLine}-${result.chunk.endLine}\n`);
  });
}

main().catch((error) => { console.error("Vector search failed:"); console.error(error); process.exit(1); });
