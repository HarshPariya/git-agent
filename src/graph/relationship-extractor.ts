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

function normalizeId(value: string): string {
  return value
    .replace(/\\/g, "/")
    .replace(/[^a-zA-Z0-9/_-]/g, "-")
    .toLowerCase();
}

function createRelationshipId(
  sourceId: string,
  type: RelationshipType,
  targetId: string,
): string {
  return `${sourceId}:${type}:${targetId}`;
}

function createContainsRelationships(
  file: ParsedFile,
  entities: GraphEntity[],
): GraphRelationship[] {
  const relationships: GraphRelationship[] = [];
  const fileEntityId = `file:${normalizeId(file.filePath)}`;

  const childEntities = entities.filter(
    (entity) =>
      entity.filePath === file.filePath &&
      (entity.type === "function" || entity.type === "class"),
  );

  for (const child of childEntities) {
    relationships.push({
      id: createRelationshipId(fileEntityId, "contains", child.id),
      type: "contains",
      sourceId: fileEntityId,
      targetId: child.id,
      metadata: { filePath: file.filePath },
    });
  }

  return relationships;
}

function resolveImportedFile(file: ParsedFile, source: string, parsedFiles: ParsedFile[]): ParsedFile | undefined {
  if (!source.startsWith(".")) return undefined;
  const joined = path.posix.normalize(path.posix.join(path.posix.dirname(file.filePath), source));
  const base = joined.replace(/\.(?:mjs|cjs|js|jsx|ts|tsx)$/i, "");
  const extensions = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
  const candidates = new Set(extensions.flatMap((extension) => [base + extension, `${base}/index${extension}`]));
  return parsedFiles.find((candidate) => candidates.has(candidate.filePath.replace(/\\/g, "/")));
}

function createImportRelationships(file: ParsedFile, parsedFiles: ParsedFile[]): GraphRelationship[] {
  const relationships: GraphRelationship[] = [];
  const fileEntityId = `file:${normalizeId(file.filePath)}`;

  for (const importedModule of file.imports) {
    const resolvedFile = resolveImportedFile(file, importedModule.source, parsedFiles);
    const moduleEntityId = resolvedFile
      ? `file:${normalizeId(resolvedFile.filePath)}`
      : `module:${normalizeId(importedModule.source)}`;

    relationships.push({
      id: createRelationshipId(fileEntityId, "imports", moduleEntityId),
      type: "imports",
      sourceId: fileEntityId,
      targetId: moduleEntityId,
      metadata: {
        source: importedModule.source,
        names: importedModule.names,
        line: importedModule.line,
        resolution: resolvedFile ? "resolved-file" : "external-module",
        ...(resolvedFile ? { resolvedFilePath: resolvedFile.filePath } : {}),
      },
    });
  }

  return relationships;
}

function extractFunctionCalls(functionContent: string): string[] {
  const calls = new Set<string>();

  // Standard function call: foo()
  const callPattern = /\b([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;
  // Method call / static class call: Bar.foo() or bar.foo()
  const methodCallPattern = /\b([A-Za-z_$][A-Za-z0-9_$]*)\.([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;

  const ignoredCalls = new Set([
    "if",
    "for",
    "while",
    "switch",
    "catch",
    "function",
    "constructor",
    "console",
    "require",
    "super",
    "import",
  ]);

  let match: RegExpExecArray | null;

  while ((match = callPattern.exec(functionContent)) !== null) {
    const functionName = match[1];
    if (functionName && !ignoredCalls.has(functionName)) {
      calls.add(functionName);
    }
  }

  while ((match = methodCallPattern.exec(functionContent)) !== null) {
    const objectName = match[1];
    const methodName = match[2];
    if (objectName && methodName && !ignoredCalls.has(objectName) && !ignoredCalls.has(methodName)) {
      calls.add(`${objectName}.${methodName}`);
      calls.add(methodName);
    }
  }

  return Array.from(calls);
}

function createCallRelationships(
  file: ParsedFile,
  entities: GraphEntity[],
): GraphRelationship[] {
  const relationships: GraphRelationship[] = [];
  const functionEntities = entities.filter((e) => e.type === "function");

  for (const fn of file.functions) {
    const caller = functionEntities.find(
      (e) =>
        e.filePath === file.filePath &&
        e.name === fn.name &&
        e.startLine === fn.startLine,
    );

    if (!caller) {
      continue;
    }

    const calledFunctionNames = extractFunctionCalls(fn.content);

    for (const calledName of calledFunctionNames) {
      if (calledName === fn.name) {
        continue;
      }

      // Priority 1: Same file function resolution
      const sameFileTarget = functionEntities.find(
        (e) => e.filePath === file.filePath && e.name === calledName,
      );

      if (sameFileTarget) {
        relationships.push({
          id: createRelationshipId(caller.id, "calls", sameFileTarget.id),
          type: "calls",
          sourceId: caller.id,
          targetId: sameFileTarget.id,
          metadata: {
            caller: fn.name,
            callee: calledName,
            resolution: "same-file",
          },
        });
        continue;
      }

      // Priority 2: Imported function resolution
      const importedFunctionNames = file.imports.flatMap((imp) => imp.names);
      if (importedFunctionNames.includes(calledName) || calledName.includes(".")) {
        const simpleName = calledName.includes(".") ? calledName.split(".")[1] : calledName;
        const possibleTargets = functionEntities.filter((e) => e.name === calledName || e.name === simpleName);

        if (possibleTargets.length === 1 && possibleTargets[0]) {
          const target = possibleTargets[0];
          relationships.push({
            id: createRelationshipId(caller.id, "calls", target.id),
            type: "calls",
            sourceId: caller.id,
            targetId: target.id,
            metadata: {
              caller: fn.name,
              callee: calledName,
              resolution: "imported-name",
            },
          });
        }
      }
    }
  }

  return relationships;
}

export function extractRelationshipsFromFile(
  file: ParsedFile,
  entities: GraphEntity[],
  parsedFiles: ParsedFile[] = [file],
): GraphRelationship[] {
  return [
    ...createContainsRelationships(file, entities),
    ...createImportRelationships(file, parsedFiles),
    ...createCallRelationships(file, entities),
  ];
}

export function extractRelationships(
  parsedFiles: ParsedFile[],
  entities: GraphEntity[],
): GraphRelationship[] {
  const relationshipMap = new Map<string, GraphRelationship>();

  for (const file of parsedFiles) {
    const relationships = extractRelationshipsFromFile(file, entities, parsedFiles);
    for (const relationship of relationships) {
      if (!relationshipMap.has(relationship.id)) {
        relationshipMap.set(relationship.id, relationship);
      }
    }
  }

  return Array.from(relationshipMap.values());
}
