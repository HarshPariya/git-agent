import { parseRepository } from "../ingestion/parser.js";
import { extractEntities } from "../graph/entity-extractor.js";
import { extractRelationships } from "../graph/relationship-extractor.js";
import { buildGraph, getGraphStats } from "../graph/graph-builder.js";
import { graphSearch } from "./graph-search.js";

const main = async (): Promise<void> => {
  console.log("Building repository GraphRAG index...\n");

  const parsedFiles = await parseRepository(process.cwd());
  const entities = extractEntities(parsedFiles);
  const relationships = extractRelationships(parsedFiles, entities);
  const graph = buildGraph(entities, relationships);
  const stats = getGraphStats(graph);

  console.log(`Nodes: ${stats.totalNodes}\nEdges: ${stats.totalEdges}`);

  const query = process.argv.slice(2).join(" ") || "Where is normalizeId used?";
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nQuery: "${query}"\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  const results = graphSearch(graph, query, { limit: 10, maxDepth: 2 });

  if (results.length === 0) {
    console.log("No graph results found.");
    return;
  }

  for (const [index, result] of results.entries()) {
    const { entity, score, matchType, depth } = result;
    const lines =
      entity.startLine !== undefined && entity.endLine !== undefined
        ? `\n   Lines: ${entity.startLine}-${entity.endLine}`
        : "";
    const file = entity.filePath ? `\n   File: ${entity.filePath}` : "";

    console.log(
      `${index + 1}. ${entity.type.toUpperCase()} — ${entity.name}\n` +
        `   Score: ${score.toFixed(3)}\n   Match: ${matchType}\n   Depth: ${depth}` +
        file +
        lines +
        "\n",
    );
  }
};

main().catch((error: unknown) => {
  console.error("Graph search failed:", error);
  process.exit(1);
});
