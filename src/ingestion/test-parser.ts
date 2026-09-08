import { parseRepository, scanRepository } from "./parser.js";
import { chunkRepository } from "./chunker.js";
import { extractEntities } from "../graph/entity-extractor.js";
import { extractRelationships } from "../graph/relationship-extractor.js";
import { buildGraph, findEntitiesByName, getGraphStats, traverseGraph } from "../graph/graph-builder.js";

async function main() {
  const root = process.cwd();

  console.log("\nScanning repository...\n");
  const files = await scanRepository(root);
  console.log(`Source files found: ${files.length}`);

  const parsedFiles = await parseRepository(root);
  const functionCount = parsedFiles.reduce((t, f) => t + f.functions.length, 0);
  const classCount = parsedFiles.reduce((t, f) => t + f.classes.length, 0);
  const importCount = parsedFiles.reduce((t, f) => t + f.imports.length, 0);

  console.log(`Files parsed: ${parsedFiles.length}\nFunctions found: ${functionCount}\nClasses found: ${classCount}\nImports found: ${importCount}`);
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nCHUNKING\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const chunks = chunkRepository(parsedFiles);
  const functionChunks = chunks.filter((c) => c.type === "function");
  const classChunks = chunks.filter((c) => c.type === "class");
  const fileChunks = chunks.filter((c) => c.type === "file");

  console.log(`Total chunks: ${chunks.length}\nFunction chunks: ${functionChunks.length}\nClass chunks: ${classChunks.length}\nFile chunks: ${fileChunks.length}\n\nSample chunks:\n`);
  for (const chunk of chunks.slice(0, 8)) {
    console.log(`  ${chunk.id}\n  Type: ${chunk.type}\n  Name: ${chunk.name}\n  Lines: ${chunk.startLine}-${chunk.endLine}\n  File: ${chunk.filePath}\n`);
  }

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nGRAPH ENTITY EXTRACTION\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const entities = extractEntities(parsedFiles);
  const fileEntities = entities.filter((e) => e.type === "file");
  const functionEntities = entities.filter((e) => e.type === "function");
  const classEntities = entities.filter((e) => e.type === "class");
  const moduleEntities = entities.filter((e) => e.type === "module");

  console.log(`Total entities: ${entities.length}\nFile entities: ${fileEntities.length}\nFunction entities: ${functionEntities.length}\nClass entities: ${classEntities.length}\nModule entities: ${moduleEntities.length}\n\nSample graph entities:\n`);
  for (const entity of entities.slice(0, 8)) {
    let info = `  ${entity.id}\n  Type: ${entity.type}\n  Name: ${entity.name}`;
    if (entity.filePath) info += `\n  File: ${entity.filePath}`;
    if (entity.startLine !== undefined && entity.endLine !== undefined) info += `\n  Lines: ${entity.startLine}-${entity.endLine}`;
    console.log(`${info}\n`);
  }

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nGRAPH RELATIONSHIP EXTRACTION\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const relationships = extractRelationships(parsedFiles, entities);
  const containsRelationships = relationships.filter((r) => r.type === "contains");
  const importRelationships = relationships.filter((r) => r.type === "imports");
  const callRelationships = relationships.filter((r) => r.type === "calls");

  console.log(`Total relationships: ${relationships.length}\nCONTAINS: ${containsRelationships.length}\nIMPORTS: ${importRelationships.length}\nCALLS: ${callRelationships.length}\n\nSample relationships:\n`);
  for (const rel of relationships.slice(0, 10)) {
    console.log(`  ${rel.type.toUpperCase()}\n  ${rel.sourceId}\n      ↓\n  ${rel.targetId}\n`);
  }

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nGRAPH BUILD\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const graph = buildGraph(entities, relationships);
  const stats = getGraphStats(graph);
  console.log(`Graph nodes: ${stats.totalNodes}\nGraph edges: ${stats.totalEdges}\n\nEntity breakdown:\n${stats.entityCounts}\n\nRelationship breakdown:\n${stats.relationshipCounts}`);

  const normalizeMatches = findEntitiesByName(graph, "normalizeId");
  if (normalizeMatches.length > 0 && normalizeMatches[0]) {
    console.log(`\nTraversal from: ${normalizeMatches[0].name}\n`);
    const traversal = traverseGraph(graph, normalizeMatches[0].id, { maxDepth: 2 });
    for (const result of traversal) {
      console.log(`${"  ".repeat(result.depth)}↳ ${result.entity.type}: ${result.entity.name}`);
    }
  }
}

main().catch((error) => { console.error("Parser/chunker test failed:"); console.error(error); process.exit(1); });
