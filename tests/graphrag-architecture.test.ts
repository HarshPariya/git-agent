import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import type { ParsedFile } from "../src/ingestion/parser.js";
import { extractEntities } from "../src/graph/entity-extractor.js";
import { extractRelationships } from "../src/graph/relationship-extractor.js";
import { inferHybridWeights } from "../src/retrieval/hybrid-search.js";
import { toRepositoryPath } from "../src/retrieval/repository-path.js";

const parsedFile = (filePath: string, imports: ParsedFile["imports"] = []): ParsedFile => ({
  filePath,
  language: "typescript",
  content: "export const value = 1;",
  imports,
  functions: [],
  classes: [],
});

test("repository identities are stable and use forward slashes", () => {
  const root = path.resolve("C:/work/repository");
  assert.equal(toRepositoryPath(root, path.join(root, "src", "agent", "critic.ts")), "src/agent/critic.ts");
});

test("relative imports resolve to repository file graph nodes", () => {
  const files = [
    parsedFile("src/api/chat.ts", [{ source: "../retrieval/unified-retriever.js", names: ["UnifiedRetriever"], line: 4 }]),
    parsedFile("src/retrieval/unified-retriever.ts"),
  ];
  const relationships = extractRelationships(files, extractEntities(files));
  const edge = relationships.find((relationship) => relationship.type === "imports");
  assert.equal(edge?.targetId, "file:src/retrieval/unified-retriever-ts");
  assert.equal(edge?.metadata.resolution, "resolved-file");
});

test("relationship and trace queries favor graph evidence", () => {
  const trace = inferHybridWeights("Trace the execution flow from chat.ts to UnifiedRetriever");
  assert.ok(trace.graphWeight > trace.vectorWeight);
  const explanation = inferHybridWeights("Explain how critic.ts works");
  assert.ok(explanation.vectorWeight > explanation.graphWeight);
});

