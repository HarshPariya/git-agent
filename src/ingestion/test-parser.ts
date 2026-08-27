import {
  parseRepository,
  scanRepository,
} from "./parser.js";

import {
  chunkRepository,
} from "./chunker.js";

import {
  extractEntities,
} from "../graph/entity-extractor.js";

import {
  extractRelationships,
} from "../graph/relationship-extractor.js";

import {
  buildGraph,
  findEntitiesByName,
  getGraphStats,
  traverseGraph,
} from "../graph/graph-builder.js";

async function main() {
  const root = process.cwd();

  console.log("🔍 Scanning repository...");
  console.log();

  const files = await scanRepository(root);

  console.log(`✓ Source files found: ${files.length}`);

  const parsedFiles = await parseRepository(root);

  const functionCount = parsedFiles.reduce(
    (total, file) => total + file.functions.length,
    0,
  );

  const classCount = parsedFiles.reduce(
    (total, file) => total + file.classes.length,
    0,
  );

  const importCount = parsedFiles.reduce(
    (total, file) => total + file.imports.length,
    0,
  );

  console.log(`✓ Files parsed: ${parsedFiles.length}`);
  console.log(`✓ Functions found: ${functionCount}`);
  console.log(`✓ Classes found: ${classCount}`);
  console.log(`✓ Imports found: ${importCount}`);

  console.log();
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("CHUNKING");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log();

  const chunks = chunkRepository(parsedFiles);

  const functionChunks = chunks.filter(
    (chunk) => chunk.type === "function",
  );

  const classChunks = chunks.filter(
    (chunk) => chunk.type === "class",
  );

  const fileChunks = chunks.filter(
    (chunk) => chunk.type === "file",
  );

  console.log(`✓ Total chunks: ${chunks.length}`);
  console.log(`✓ Function chunks: ${functionChunks.length}`);
  console.log(`✓ Class chunks: ${classChunks.length}`);
  console.log(`✓ File chunks: ${fileChunks.length}`);

  console.log();
  console.log("Sample chunks:");
  console.log();

  for (const chunk of chunks.slice(0, 8)) {
    console.log(`🧩 ${chunk.id}`);
    console.log(`   Type: ${chunk.type}`);
    console.log(`   Name: ${chunk.name}`);
    console.log(
      `   Lines: ${chunk.startLine}-${chunk.endLine}`,
    );
    console.log(`   File: ${chunk.filePath}`);
    console.log();
  }

  console.log();
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("GRAPH ENTITY EXTRACTION");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log();

  const entities = extractEntities(parsedFiles);

  const fileEntities = entities.filter(
    (entity) => entity.type === "file",
  );

  const functionEntities = entities.filter(
    (entity) => entity.type === "function",
  );

  const classEntities = entities.filter(
    (entity) => entity.type === "class",
  );

  const moduleEntities = entities.filter(
    (entity) => entity.type === "module",
  );

  console.log(`✓ Total entities: ${entities.length}`);
  console.log(`✓ File entities: ${fileEntities.length}`);
  console.log(`✓ Function entities: ${functionEntities.length}`);
  console.log(`✓ Class entities: ${classEntities.length}`);
  console.log(`✓ Module entities: ${moduleEntities.length}`);

  console.log();
  console.log("Sample graph entities:");
  console.log();

  for (const entity of entities.slice(0, 8)) {
    console.log(`🔹 ${entity.id}`);
    console.log(`   Type: ${entity.type}`);
    console.log(`   Name: ${entity.name}`);

    if (entity.filePath) {
      console.log(`   File: ${entity.filePath}`);
    }

    if (
      entity.startLine !== undefined &&
      entity.endLine !== undefined
    ) {
      console.log(
        `   Lines: ${entity.startLine}-${entity.endLine}`,
      );
    }

    console.log();
  }

  console.log();
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("GRAPH RELATIONSHIP EXTRACTION");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log();

  const relationships = extractRelationships(
    parsedFiles,
    entities,
  );

  const containsRelationships =
    relationships.filter(
      (relationship) =>
        relationship.type === "contains",
    );

  const importRelationships =
    relationships.filter(
      (relationship) =>
        relationship.type === "imports",
    );

  const callRelationships =
    relationships.filter(
      (relationship) =>
        relationship.type === "calls",
    );

  console.log(
    `✓ Total relationships: ${relationships.length}`,
  );

  console.log(
    `✓ CONTAINS relationships: ${containsRelationships.length}`,
  );

  console.log(
    `✓ IMPORTS relationships: ${importRelationships.length}`,
  );

  console.log(
    `✓ CALLS relationships: ${callRelationships.length}`,
  );

  console.log();
  console.log("Sample relationships:");
  console.log();

  for (
    const relationship
    of relationships.slice(0, 10)
  ) {
    console.log(
      `🔗 ${relationship.type.toUpperCase()}`,
    );

    console.log(
      `   ${relationship.sourceId}`,
    );

    console.log("       ↓");

    console.log(
      `   ${relationship.targetId}`,
    );

    console.log();
  }

  console.log();
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("GRAPH BUILD");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log();

  const graph = buildGraph(
    entities,
    relationships,
  );

  const stats = getGraphStats(graph);

  console.log(`✓ Graph nodes: ${stats.totalNodes}`);
  console.log(`✓ Graph edges: ${stats.totalEdges}`);

  console.log();
  console.log("Entity breakdown:");
  console.log(stats.entityCounts);

  console.log();
  console.log("Relationship breakdown:");
  console.log(stats.relationshipCounts);

  const normalizeMatches =
    findEntitiesByName(
      graph,
      "normalizeId",
    );

  if (normalizeMatches.length > 0) {
    const start =
      normalizeMatches[0];

    console.log();
    console.log(
      `Traversal from: ${start.name}`,
    );
    console.log();

    const traversal =
      traverseGraph(
        graph,
        start.id,
        {
          maxDepth: 2,
        },
      );

    for (const result of traversal) {
      console.log(
        `${"  ".repeat(result.depth)}↳ ${result.entity.type}: ${result.entity.name}`,
      );
    }
  }
}

main().catch((error) => {
  console.error("Parser/chunker test failed:");
  console.error(error);
  process.exit(1);
});