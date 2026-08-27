import path from "node:path";

import type {
  ParsedFile,
  ParsedFunction,
  ParsedClass,
} from "../ingestion/parser.js";

export type EntityType =
  | "file"
  | "function"
  | "class"
  | "module";

export interface GraphEntity {
  id: string;
  type: EntityType;

  name: string;

  filePath?: string;

  startLine?: number;
  endLine?: number;

  language?: string;

  metadata: Record<string, unknown>;
}

function normalizeId(value: string): string {
  return value
    .replace(/\\/g, "/")
    .replace(/[^a-zA-Z0-9/_-]/g, "-")
    .toLowerCase();
}

function createFileEntity(file: ParsedFile): GraphEntity {
  return {
    id: `file:${normalizeId(file.filePath)}`,

    type: "file",

    name: path.basename(file.filePath),

    filePath: file.filePath,

    startLine: 1,

    endLine: file.content
      ? file.content.split(/\r?\n/).length
      : 1,

    language: file.language,

    metadata: {
      directory: path.dirname(file.filePath),
      imports: file.imports.map((item) => item.source),
    },
  };
}

function createFunctionEntity(
  file: ParsedFile,
  fn: ParsedFunction,
): GraphEntity {
  return {
    id: `function:${normalizeId(file.filePath)}:${normalizeId(fn.name)}:${fn.startLine}`,

    type: "function",

    name: fn.name,

    filePath: file.filePath,

    startLine: fn.startLine,
    endLine: fn.endLine,

    language: file.language,

    metadata: {
      parentFile: file.filePath,
    },
  };
}

function createClassEntity(
  file: ParsedFile,
  classInfo: ParsedClass,
): GraphEntity {
  return {
    id: `class:${normalizeId(file.filePath)}:${normalizeId(classInfo.name)}:${classInfo.startLine}`,

    type: "class",

    name: classInfo.name,

    filePath: file.filePath,

    startLine: classInfo.startLine,
    endLine: classInfo.endLine,

    language: file.language,

    metadata: {
      parentFile: file.filePath,
    },
  };
}

function createModuleEntities(
  file: ParsedFile,
): GraphEntity[] {
  const modules: GraphEntity[] = [];

  for (const importedModule of file.imports) {
    modules.push({
      id: `module:${normalizeId(importedModule.source)}`,

      type: "module",

      name: importedModule.source,

      metadata: {
        importedBy: file.filePath,
      },
    });
  }

  return modules;
}

export function extractEntitiesFromFile(
  file: ParsedFile,
): GraphEntity[] {
  const entities: GraphEntity[] = [];

  entities.push(createFileEntity(file));

  for (const fn of file.functions) {
    entities.push(createFunctionEntity(file, fn));
  }

  for (const classInfo of file.classes) {
    entities.push(createClassEntity(file, classInfo));
  }

  entities.push(...createModuleEntities(file));

  return entities;
}

export function extractEntities(
  parsedFiles: ParsedFile[],
): GraphEntity[] {
  const entityMap = new Map<string, GraphEntity>();

  for (const file of parsedFiles) {
    const entities = extractEntitiesFromFile(file);

    for (const entity of entities) {
      if (!entityMap.has(entity.id)) {
        entityMap.set(entity.id, entity);
      }
    }
  }

  return Array.from(entityMap.values());
}
