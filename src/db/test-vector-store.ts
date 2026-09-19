import type { VectorSearchResult } from "../retrieval/vector-search.js";
import { parseRepository } from "../ingestion/parser.js";
import { chunkRepository } from "../ingestion/chunker.js";
import { closeDatabase, testDatabaseConnection } from "./mongodb.js";
import { initializeSchema } from "./schema.js";
import { upsertChunks, mongoVectorSearch } from "./vector-store.js";

const SEPARATOR = "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━";

const printResult = (result: VectorSearchResult, index: number) => {
  console.warn(`${index + 1}. ${result.chunk.type.toUpperCase()} — ${result.chunk.name}`);
  console.warn(`   Similarity: ${result.score.toFixed(4)}`);
  console.warn(`   File: ${result.chunk.filePath}\n`);
};

const main = async () => {
  console.warn(SEPARATOR);
  console.warn("METADATA FILTERED MONGODB VECTOR TEST");
  console.warn(`${SEPARATOR}\n`);

  if (!(await testDatabaseConnection())) {
    process.exitCode = 1;
    return;
  }

  initializeSchema();
  console.warn("\nParsing & chunking repository...");

  const chunks = chunkRepository(await parseRepository(process.cwd()));
  await upsertChunks("ai-chatbot", chunks);

  const queryText = process.argv.slice(2).join(" ") || "Where is normalizeId used?";

  console.warn(`\n${SEPARATOR}`);
  console.warn(`1. Unfiltered Vector Search: "${queryText}"`);
  console.warn(`${SEPARATOR}\n`);

  const allResults = await mongoVectorSearch(queryText, { repository: "ai-chatbot", limit: 5 });
  allResults.forEach(printResult);

  console.warn(`\n${SEPARATOR}`);
  console.warn(`2. Filtered Search (chunkType: function, language: typescript): "${queryText}"`);
  console.warn(`${SEPARATOR}\n`);

  const filteredResults = await mongoVectorSearch(queryText, {
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
