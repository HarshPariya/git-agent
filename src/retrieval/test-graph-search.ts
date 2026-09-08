import { parseRepository } from "../ingestion/parser.js";
import { extractEntities } from "../graph/entity-extractor.js";
import { extractRelationships } from "../graph/relationship-extractor.js";
import { buildGraph, getGraphStats } from "../graph/graph-builder.js";
import { graphSearch } from "./graph-search.js";

async function main() {
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
  if (results.length === 0) { console.log("No graph results found."); return; }

  results.forEach((result, index) => {
    console.log(`${index + 1}. ${result.entity.type.toUpperCase()} — ${result.entity.name}`);
    console.log(`   Score: ${result.score.toFixed(3)}\n   Match: ${result.matchType}\n   Depth: ${result.depth}`);
    if (result.entity.filePath) console.log(`   File: ${result.entity.filePath}`);
    if (result.entity.startLine !== undefined && result.entity.endLine !== undefined)
      console.log(`   Lines: ${result.entity.startLine}-${result.entity.endLine}`);
    console.log();
  });
}

main().catch((error) => { console.error("Graph search failed:"); console.error(error); process.exit(1); });
