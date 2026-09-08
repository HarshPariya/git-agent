import { parseRepository } from "../ingestion/parser.js";
import { chunkRepository } from "../ingestion/chunker.js";
import { closeDatabase, testDatabaseConnection } from "./postgres.js";
import { initializeSchema } from "./schema.js";
import { upsertChunks, pgVectorSearch } from "./vector-store.js";

const printResult = (result: any, index: number) => {
  console.log(`${index + 1}. ${result.chunk.type.toUpperCase()} — ${result.chunk.name}`);
  console.log(`   Similarity: ${result.score.toFixed(4)}`);
  console.log(`   File: ${result.chunk.filePath}\n`);
};

async function main() {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("METADATA FILTERED PGVECTOR TEST");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  if (!(await testDatabaseConnection())) {
    process.exitCode = 1;
    return;
  }

  await initializeSchema();
  console.log("\n🔍 Parsing & chunking repository...");

  const chunks = chunkRepository(await parseRepository(process.cwd()));
  await upsertChunks("ai-chatbot", chunks);

  const query = process.argv.slice(2).join(" ") || "Where is normalizeId used?";

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`1. Unfiltered Vector Search: "${query}"`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const allResults = await pgVectorSearch(query, { repository: "ai-chatbot", limit: 5 });
  allResults.forEach(printResult);

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`2. Filtered Search (chunkType: function, language: typescript): "${query}"`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const filteredResults = await pgVectorSearch(query, {
    repository: "ai-chatbot",
    chunkType: "function",
    language: "typescript",
    limit: 5,
  });
  filteredResults.forEach(printResult);
}

main()
  .catch((error) => {
    console.error("Filtered vector search test failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabase();
  });
