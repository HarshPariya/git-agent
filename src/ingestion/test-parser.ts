import { parseRepository, scanRepository } from "./parser.js";
import { chunkRepository } from "./chunker.js";
import { extractEntities } from "../graph/entity-extractor.js";
import { extractRelationships } from "../graph/relationship-extractor.js";
import { buildGraph, findEntitiesByName, getGraphStats, traverseGraph } from "../graph/graph-builder.js";

const sumBy = <T>(items: T[], fn: (item: T) => number): number => items.reduce((total, item) => total + fn(item), 0);

const logSample = <T>(items: T[], label: string, format: (item: T) => string, limit = 8) => {
  console.warn(`Sample ${label}:\n`);
  for (const item of items.slice(0, limit)) console.warn(format(item));
};

const main = async () => {
  const root = process.cwd();

  console.warn("\nScanning repository...\n");
  const files = await scanRepository(root);
  console.warn(`Source files found: ${files.length}`);

  const parsedFiles = await parseRepository(root);
  const totalFunctions = sumBy(parsedFiles, (f) => f.functions.length);
  const totalClasses = sumBy(parsedFiles, (f) => f.classes.length);
  const totalImports = sumBy(parsedFiles, (f) => f.imports.length);
  console.warn(`Files parsed: ${parsedFiles.length}\nFunctions found: ${totalFunctions}\nClasses found: ${totalClasses}\nImports found: ${totalImports}`);

  // Chunking
  console.warn("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nCHUNKING\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const chunks = chunkRepository(parsedFiles);
  const chunkCounts = ["function", "class", "file"] as const;
  const counts = Object.fromEntries(chunkCounts.map((type) => [type, chunks.filter((c) => c.type === type).length])) as Record<string, number>;
  console.warn(`Total chunks: ${chunks.length}\nFunction chunks: ${counts.function}\nClass chunks: ${counts.class}\nFile chunks: ${counts.file}`);

  logSample(chunks, "chunks", (c) => `  ${c.id}\n  Type: ${c.type}\n  Name: ${c.name}\n  Lines: ${c.startLine}-${c.endLine}\n  File: ${c.filePath}\n`);

  // Entity Extraction
  console.warn("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nGRAPH ENTITY EXTRACTION\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const entities = extractEntities(parsedFiles);
  const entityTypes = ["file", "function", "class", "module"] as const;
  const entityCounts = Object.fromEntries(entityTypes.map((type) => [type, entities.filter((e) => e.type === type).length])) as Record<string, number>;
  console.warn(`Total entities: ${entities.length}\nFile entities: ${entityCounts.file}\nFunction entities: ${entityCounts.function}\nClass entities: ${entityCounts.class}\nModule entities: ${entityCounts.module}`);

  logSample(entities, "graph entities", (e) => {
    const lines = [`  ${e.id}`, `  Type: ${e.type}`, `  Name: ${e.name}`];
    if (e.filePath) lines.push(`  File: ${e.filePath}`);
    if (e.startLine !== undefined && e.endLine !== undefined) lines.push(`  Lines: ${e.startLine}-${e.endLine}`);
    return `${lines.join("\n")}\n`;
  });

  // Relationship Extraction
  console.warn("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nGRAPH RELATIONSHIP EXTRACTION\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const relationships = extractRelationships(parsedFiles, entities);
  const relTypes = ["contains", "imports", "calls"] as const;
  const relCounts = Object.fromEntries(relTypes.map((type) => [type, relationships.filter((r) => r.type === type).length])) as Record<string, number>;
  console.warn(`Total relationships: ${relationships.length}\nCONTAINS: ${relCounts.contains}\nIMPORTS: ${relCounts.imports}\nCALLS: ${relCounts.calls}`);

  logSample(relationships, "relationships", (r) => `  ${r.type.toUpperCase()}\n  ${r.sourceId}\n      ↓\n  ${r.targetId}\n`, 10);

  // Graph Build
  console.warn("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nGRAPH BUILD\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const graph = buildGraph(entities, relationships);
  const stats = getGraphStats(graph);
  console.warn(`Graph nodes: ${stats.totalNodes}\nGraph edges: ${stats.totalEdges}\n\nEntity breakdown:\n${JSON.stringify(stats.entityCounts)}\n\nRelationship breakdown:\n${JSON.stringify(stats.relationshipCounts)}`);

  const [firstMatch] = findEntitiesByName(graph, "normalizeId");
  if (firstMatch) {
    console.warn(`\nTraversal from: ${firstMatch.name}\n`);
    for (const { depth, entity } of traverseGraph(graph, firstMatch.id, { maxDepth: 2 })) {
      console.warn(`${"  ".repeat(depth)}↳ ${entity.type}: ${entity.name}`);
    }
  }
};

main().catch((error) => {
  console.error("Parser/chunker test failed:");
  console.error(error);
  process.exit(1);
});
