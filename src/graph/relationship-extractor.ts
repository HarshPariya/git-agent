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
    .filter(({ filePath, type }) => filePath === file.filePath && (type === "function" || type === "class"))
    .map(({ id }) => ({
      id: createRelationshipId(fileEntityId, "contains", id),
      type: "contains" as const,
      sourceId: fileEntityId,
      targetId: id,
      metadata: { filePath: file.filePath },
    }));
};

const resolveImportedFile = (file: ParsedFile, source: string, parsedFiles: ParsedFile[]): ParsedFile | undefined => {
  if (!source.startsWith(".")) return undefined;

  const joined = path.posix.normalize(path.posix.join(path.posix.dirname(file.filePath), source));
  const base = joined.replace(/\.(?:mjs|cjs|js|jsx|ts|tsx)$/i, "");
  const extensions = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
  const candidates = new Set(extensions.flatMap((ext) => [base + ext, `${base}/index${ext}`]));

  return parsedFiles.find(({ filePath }) => candidates.has(filePath.replace(/\\/g, "/")));
};

const createImportRelationships = (file: ParsedFile, parsedFiles: ParsedFile[]): GraphRelationship[] => {
  const fileEntityId = `file:${normalizeId(file.filePath)}`;
  return file.imports.map((imp) => {
    const resolvedFile = resolveImportedFile(file, imp.source, parsedFiles);
    const moduleEntityId = resolvedFile ? `file:${normalizeId(resolvedFile.filePath)}` : `module:${normalizeId(imp.source)}`;
    return {
      id: createRelationshipId(fileEntityId, "imports", moduleEntityId),
      type: "imports" as const,
      sourceId: fileEntityId,
      targetId: moduleEntityId,
      metadata: {
        source: imp.source,
        names: imp.names,
        line: imp.line,
        resolution: resolvedFile ? "resolved-file" : "external-module",
        ...Object.fromEntries(resolvedFile ? [["resolvedFilePath", resolvedFile.filePath]] : []),
      },
    };
  });
};

const extractFunctionCalls = (functionContent: string): string[] => {
  const calls = new Set<string>();
  const ignored = new Set(["if", "for", "while", "switch", "catch", "function", "constructor", "console", "require", "super", "import"]);

  const addIfNotIgnored = (name: string): void => {
    if (!ignored.has(name)) calls.add(name);
  };

  const callPattern = /\b([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;
  const methodCallPattern = /\b([A-Za-z_$][A-Za-z0-9_$]*)\.([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;

  for (const match of callPattern.exec(functionContent)?.slice(1) ?? []) {
    addIfNotIgnored(match);
  }

  for (const match of methodCallPattern.exec(functionContent)?.slice(1) ?? []) {
    if (match[0] && match[1]) {
      addIfNotIgnored(`${match[0]}.${match[1]}`);
      addIfNotIgnored(match[1]);
    }
  }

  return Array.from(calls);
};

const createCallRelationships = (file: ParsedFile, entities: GraphEntity[]): GraphRelationship[] => {
  const functionEntities = entities.filter(({ type }) => type === "function");
  const relationships: GraphRelationship[] = [];

  const findCaller = (fn: ParsedFile["functions"][0]) =>
    functionEntities.find((e) => e.filePath === file.filePath && e.name === fn.name && e.startLine === fn.startLine);

  const findSameFileTarget = (calledName: string) =>
    functionEntities.find((e) => e.filePath === file.filePath && e.name === calledName);

  const findImportedTarget = (calledName: string) => {
    const importedNames = file.imports.flatMap((imp) => imp.names);
    const simpleName = calledName.includes(".") ? calledName.split(".")[1] : calledName;
    const targets = functionEntities.filter((e) => e.name === calledName || e.name === simpleName);
    return (importedNames.includes(calledName) || calledName.includes(".")) && targets.length === 1 ? targets[0] : undefined;
  };

  for (const fn of file.functions) {
    const caller = findCaller(fn);
    if (!caller) continue;

    for (const calledName of extractFunctionCalls(fn.content)) {
      if (calledName === fn.name) continue;

      const target = findSameFileTarget(calledName) ?? findImportedTarget(calledName);
      if (target) {
        relationships.push({
          id: createRelationshipId(caller.id, "calls", target.id),
          type: "calls",
          sourceId: caller.id,
          targetId: target.id,
          metadata: {
            caller: fn.name,
            callee: calledName,
            resolution: findSameFileTarget(calledName) ? "same-file" : "imported-name",
          },
        });
      }
    }
  }
  return relationships;
};

export const extractRelationshipsFromFile = (
  file: ParsedFile,
  entities: GraphEntity[],
  parsedFiles: ParsedFile[] = [file]
): GraphRelationship[] => [
  ...createContainsRelationships(file, entities),
  ...createImportRelationships(file, parsedFiles),
  ...createCallRelationships(file, entities),
];

export const extractRelationships = (parsedFiles: ParsedFile[], entities: GraphEntity[]): GraphRelationship[] =>
  Array.from(
    parsedFiles
      .flatMap((file) => extractRelationshipsFromFile(file, entities, parsedFiles))
      .reduce((map, r) => map.set(r.id, r), new Map<string, GraphRelationship>())
      .values()
  );
