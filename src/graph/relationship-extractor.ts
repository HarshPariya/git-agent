import type { ParsedFile } from "../ingestion/parser.js";
import type { GraphEntity } from "./entity-extractor.js";
import path from "node:path";

export type RelationshipType = "contains" | "imports" | "calls" | "exports";

export interface GraphRelationship {
  id: string;
  type: RelationshipType;
  sourceId: string;
  targetId: string;
  metadata: Record<string, unknown>;
}

const normalizeId = (value: string): string =>
  value.replace(/\\/g, "/").replace(/[^a-zA-Z0-9/_-]/g, "-").toLowerCase();

const createRelationshipId = (sourceId: string, type: RelationshipType, targetId: string): string =>
  `${sourceId}:${type}:${targetId}`;

const createContainsRelationships = (file: ParsedFile, entities: GraphEntity[]): GraphRelationship[] => {
  const fileEntityId = `file:${normalizeId(file.filePath)}`;
  return entities
    .filter((e) => e.filePath === file.filePath && (e.type === "function" || e.type === "class"))
    .map((child) => ({
      id: createRelationshipId(fileEntityId, "contains", child.id),
      type: "contains" as const,
      sourceId: fileEntityId,
      targetId: child.id,
      metadata: { filePath: file.filePath },
    }));
};

const resolveImportedFile = (file: ParsedFile, source: string, parsedFiles: ParsedFile[]): ParsedFile | undefined => {
  if (!source.startsWith(".")) return undefined;
  const joined = path.posix.normalize(path.posix.join(path.posix.dirname(file.filePath), source));
  const base = joined.replace(/\.(?:mjs|cjs|js|jsx|ts|tsx)$/i, "");
  const extensions = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
  const candidates = new Set(extensions.flatMap((ext) => [base + ext, `${base}/index${ext}`]));
  return parsedFiles.find((c) => candidates.has(c.filePath.replace(/\\/g, "/")));
};

const createImportRelationships = (file: ParsedFile, parsedFiles: ParsedFile[]): GraphRelationship[] => {
  const fileEntityId = `file:${normalizeId(file.filePath)}`;
  return file.imports.map((imp) => {
    const resolvedFile = resolveImportedFile(file, imp.source, parsedFiles);
    const moduleEntityId = resolvedFile
      ? `file:${normalizeId(resolvedFile.filePath)}`
      : `module:${normalizeId(imp.source)}`;
    return {
      id: createRelationshipId(fileEntityId, "imports", moduleEntityId),
      type: "imports" as const,
      sourceId: fileEntityId,
      targetId: moduleEntityId,
      metadata: {
        source: imp.source, names: imp.names, line: imp.line,
        resolution: resolvedFile ? "resolved-file" : "external-module",
        ...(resolvedFile ? { resolvedFilePath: resolvedFile.filePath } : {}),
      },
    };
  });
};

const extractFunctionCalls = (functionContent: string): string[] => {
  const calls = new Set<string>();
  const callPattern = /\b([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;
  const methodCallPattern = /\b([A-Za-z_$][A-Za-z0-9_$]*)\.([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;
  const ignored = new Set(["if", "for", "while", "switch", "catch", "function", "constructor", "console", "require", "super", "import"]);
  let match: RegExpExecArray | null;

  while ((match = callPattern.exec(functionContent)) !== null) {
    if (match[1] && !ignored.has(match[1])) calls.add(match[1]);
  }
  while ((match = methodCallPattern.exec(functionContent)) !== null) {
    const [, objectName, methodName] = match;
    if (objectName && methodName && !ignored.has(objectName) && !ignored.has(methodName)) {
      calls.add(`${objectName}.${methodName}`);
      calls.add(methodName);
    }
  }
  return Array.from(calls);
};

const createCallRelationships = (file: ParsedFile, entities: GraphEntity[]): GraphRelationship[] => {
  const functionEntities = entities.filter((e) => e.type === "function");
  const relationships: GraphRelationship[] = [];

  for (const fn of file.functions) {
    const caller = functionEntities.find(
      (e) => e.filePath === file.filePath && e.name === fn.name && e.startLine === fn.startLine,
    );
    if (!caller) continue;

    for (const calledName of extractFunctionCalls(fn.content)) {
      if (calledName === fn.name) continue;

      // Priority 1: Same file function resolution
      const sameFileTarget = functionEntities.find((e) => e.filePath === file.filePath && e.name === calledName);
      if (sameFileTarget) {
        relationships.push({
          id: createRelationshipId(caller.id, "calls", sameFileTarget.id),
          type: "calls", sourceId: caller.id, targetId: sameFileTarget.id,
          metadata: { caller: fn.name, callee: calledName, resolution: "same-file" },
        });
        continue;
      }

      // Priority 2: Imported function resolution
      const importedNames = file.imports.flatMap((imp) => imp.names);
      if (importedNames.includes(calledName) || calledName.includes(".")) {
        const simpleName = calledName.includes(".") ? calledName.split(".")[1] : calledName;
        const targets = functionEntities.filter((e) => e.name === calledName || e.name === simpleName);
        if (targets.length === 1 && targets[0]) {
          relationships.push({
            id: createRelationshipId(caller.id, "calls", targets[0].id),
            type: "calls", sourceId: caller.id, targetId: targets[0].id,
            metadata: { caller: fn.name, callee: calledName, resolution: "imported-name" },
          });
        }
      }
    }
  }
  return relationships;
};

export function extractRelationshipsFromFile(
  file: ParsedFile, entities: GraphEntity[], parsedFiles: ParsedFile[] = [file],
): GraphRelationship[] {
  return [
    ...createContainsRelationships(file, entities),
    ...createImportRelationships(file, parsedFiles),
    ...createCallRelationships(file, entities),
  ];
}

export function extractRelationships(parsedFiles: ParsedFile[], entities: GraphEntity[]): GraphRelationship[] {
  const relationshipMap = new Map<string, GraphRelationship>();
  for (const file of parsedFiles) {
    for (const r of extractRelationshipsFromFile(file, entities, parsedFiles)) {
      if (!relationshipMap.has(r.id)) relationshipMap.set(r.id, r);
    }
  }
  return Array.from(relationshipMap.values());
}
