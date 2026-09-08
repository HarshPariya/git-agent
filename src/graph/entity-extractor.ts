import path from "node:path";
import type { ParsedFile, ParsedFunction, ParsedClass } from "../ingestion/parser.js";

export type EntityType = "file" | "function" | "class" | "module";

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

const normalizeId = (value: string): string =>
  value.replace(/\\/g, "/").replace(/[^a-zA-Z0-9/_-]/g, "-").toLowerCase();

const createFileEntity = (file: ParsedFile): GraphEntity => ({
  id: `file:${normalizeId(file.filePath)}`,
  type: "file",
  name: path.basename(file.filePath),
  filePath: file.filePath,
  startLine: 1,
  endLine: file.content ? file.content.split(/\r?\n/).length : 1,
  language: file.language,
  metadata: {
    directory: path.dirname(file.filePath),
    imports: file.imports.map((item) => item.source),
  },
});

const createFunctionEntity = (file: ParsedFile, fn: ParsedFunction): GraphEntity => ({
  id: `function:${normalizeId(file.filePath)}:${normalizeId(fn.name)}:${fn.startLine}`,
  type: "function",
  name: fn.name,
  filePath: file.filePath,
  startLine: fn.startLine,
  endLine: fn.endLine,
  language: file.language,
  metadata: { parentFile: file.filePath },
});

const createClassEntity = (file: ParsedFile, classInfo: ParsedClass): GraphEntity => ({
  id: `class:${normalizeId(file.filePath)}:${normalizeId(classInfo.name)}:${classInfo.startLine}`,
  type: "class",
  name: classInfo.name,
  filePath: file.filePath,
  startLine: classInfo.startLine,
  endLine: classInfo.endLine,
  language: file.language,
  metadata: { parentFile: file.filePath },
});

const createModuleEntities = (file: ParsedFile): GraphEntity[] =>
  file.imports.map((m) => ({
    id: `module:${normalizeId(m.source)}`,
    type: "module" as const,
    name: m.source,
    metadata: { importedBy: file.filePath },
  }));

export function extractEntitiesFromFile(file: ParsedFile): GraphEntity[] {
  return [
    createFileEntity(file),
    ...file.functions.map((fn) => createFunctionEntity(file, fn)),
    ...file.classes.map((c) => createClassEntity(file, c)),
    ...createModuleEntities(file),
  ];
}

export function extractEntities(parsedFiles: ParsedFile[]): GraphEntity[] {
  const entityMap = new Map<string, GraphEntity>();
  for (const file of parsedFiles) {
    for (const entity of extractEntitiesFromFile(file)) {
      if (!entityMap.has(entity.id)) entityMap.set(entity.id, entity);
    }
  }
  return Array.from(entityMap.values());
}
