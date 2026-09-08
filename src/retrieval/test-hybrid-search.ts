import { parseRepository } from "../ingestion/parser.js";
import { chunkRepository } from "../ingestion/chunker.js";
import { extractEntities } from "../graph/entity-extractor.js";
import { extractRelationships } from "../graph/relationship-extractor.js";
import { buildGraph } from "../graph/graph-builder.js";
import { pgVectorSearch, upsertChunks } from "../db/vector-store.js";
import { closeDatabase, testDatabaseConnection } from "../db/postgres.js";
import { initializeSchema } from "../db/schema.js";
import { hybridSearch } from "./hybrid-search.js";
import type { VectorSearchResult } from "./vector-search.js";

const main = async (): Promise<void> => {
  console.log("Building Persistent Hybrid RAG index...\n");

  const connected = await testDatabaseConnection();
  if (connected) {
    await initializeSchema();
  } else {
    console.warn("PostgreSQL not available. Running hybrid search in standalone AST & graph mode.");
  }

  const parsedFiles = await parseRepository(process.cwd());
  const chunks = chunkRepository(parsedFiles);
  const entities = extractEntities(parsedFiles);
  const relationships = extractRelationships(parsedFiles, entities);
  const graph = buildGraph(entities, relationships);

  console.log(`Chunks: ${chunks.length}\nGraph nodes: ${graph.nodes.size}\nGraph edges: ${graph.edges.length}`);

  let vectorResults: VectorSearchResult[] = [];
  if (connected) {
    console.log("Persisting vector index to PostgreSQL...");
    await upsertChunks("ai-chatbot", chunks);
  }

  const query = process.argv.slice(2).join(" ") || "Where is normalizeId used?";
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nQuery: "${query}"\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  if (connected) {
    vectorResults = await pgVectorSearch(query, { repository: "ai-chatbot", limit: 15 });
  }

  const results = await hybridSearch(query, graph, chunks, vectorResults, { limit: 10 });

  for (const [index, result] of results.entries()) {
    const { name, hybridScore, vectorScore, graphScore, sources, filePath, graphDepth } = result;
    const file = filePath ? `\n   File: ${filePath}` : "";
    const depth = graphDepth !== undefined ? `\n   Graph depth: ${graphDepth}` : "";

    console.log(
      `${index + 1}. ${name}\n` +
        `   Hybrid: ${hybridScore.toFixed(4)}\n   Vector: ${vectorScore.toFixed(4)}\n   Graph: ${graphScore.toFixed(4)}\n` +
        `   Sources: ${sources.join(" + ")}` +
        file +
        depth +
        "\n",
    );
  }
};

main()
  .catch((error: unknown) => {
    console.error("Hybrid search failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabase();
  });
