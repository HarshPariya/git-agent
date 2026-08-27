import { parseRepository } from "../ingestion/parser.js";
import { chunkRepository } from "../ingestion/chunker.js";
import { closeDatabase, testDatabaseConnection } from "./postgres.js";
import { initializeSchema } from "./schema.js";
import { upsertChunks, pgVectorSearch } from "./vector-store.js";

async function main() {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("METADATA FILTERED PGVECTOR TEST");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log();

  const connected = await testDatabaseConnection();
  if (!connected) {
    process.exitCode = 1;
    return;
  }

  await initializeSchema();

  console.log();
  console.log("🔍 Parsing & chunking repository...");
  const parsedFiles = await parseRepository(process.cwd());
  const chunks = chunkRepository(parsedFiles);

  await upsertChunks("ai-chatbot", chunks);

  const query = process.argv.slice(2).join(" ") || "Where is normalizeId used?";

  console.log();
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`1. Unfiltered Vector Search: "${query}"`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log();

  const allResults = await pgVectorSearch(query, {
    repository: "ai-chatbot",
    limit: 5,
  });

  allResults.forEach((result, index) => {
    console.log(`${index + 1}. ${result.chunk.type.toUpperCase()} — ${result.chunk.name}`);
    console.log(`   Similarity: ${result.score.toFixed(4)}`);
    console.log(`   File: ${result.chunk.filePath}`);
    console.log();
  });

  console.log();
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`2. Filtered Search (chunkType: function, language: typescript): "${query}"`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log();

  const filteredResults = await pgVectorSearch(query, {
    repository: "ai-chatbot",
    chunkType: "function",
    language: "typescript",
    limit: 5,
  });

  filteredResults.forEach((result, index) => {
    console.log(`${index + 1}. ${result.chunk.type.toUpperCase()} — ${result.chunk.name}`);
    console.log(`   Similarity: ${result.score.toFixed(4)}`);
    console.log(`   File: ${result.chunk.filePath}`);
    console.log();
  });
}

main()
  .catch((error) => {
    console.error("Filtered vector search test failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabase();
  });
