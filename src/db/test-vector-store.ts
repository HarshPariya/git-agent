import type { VectorSearchResult } from "../retrieval/vector-search.js";
import { parseRepository } from "../ingestion/parser.js";
import { chunkRepository } from "../ingestion/chunker.js";
import { closeDatabase, testDatabaseConnection } from "./postgres.js";
import { initializeSchema } from "./schema.js";
import { upsertChunks, pgVectorSearch } from "./vector-store.js";

const SEPARATOR = "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━";

const printResult = (result: VectorSearchResult, index: number) => {
  console.log(`${index + 1}. ${result.chunk.type.toUpperCase()} — ${result.chunk.name}`);
  console.log(`   Similarity: ${result.score.toFixed(4)}`);
  console.log(`   File: ${result.chunk.filePath}\n`);
};

const main = async () => {
  console.log(SEPARATOR);
  console.log("METADATA FILTERED PGVECTOR TEST");
  console.log(`${SEPARATOR}\n`);

  if (!(await testDatabaseConnection())) {
    process.exitCode = 1;
    return;
  }

  await initializeSchema();
  console.log("\nParsing & chunking repository...");

  const chunks = chunkRepository(await parseRepository(process.cwd()));
  await upsertChunks("ai-chatbot", chunks);

  const queryText = process.argv.slice(2).join(" ") || "Where is normalizeId used?";

  console.log(`\n${SEPARATOR}`);
  console.log(`1. Unfiltered Vector Search: "${queryText}"`);
  console.log(`${SEPARATOR}\n`);

  const allResults = await pgVectorSearch(queryText, { repository: "ai-chatbot", limit: 5 });
  allResults.forEach(printResult);

  console.log(`\n${SEPARATOR}`);
  console.log(`2. Filtered Search (chunkType: function, language: typescript): "${queryText}"`);
  console.log(`${SEPARATOR}\n`);

  const filteredResults = await pgVectorSearch(queryText, {
    repository: "ai-chatbot",
    chunkType: "function",
    language: "typescript",
    limit: 5,
  });
  filteredResults.forEach(printResult);
};

main()
  .catch((error) => {
    console.error("Filtered vector search test failed:", error);
    process.exitCode = 1;
  })
  .finally(closeDatabase);
