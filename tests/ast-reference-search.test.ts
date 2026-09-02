import assert from "node:assert/strict";
import test from "node:test";

import type { ParsedFile } from "../src/ingestion/parser.js";
import { findAstSymbolReferences } from "../src/retrieval/ast-reference-search.js";

const file = (filePath: string, content: string): ParsedFile => ({
  filePath,
  content,
  language: "typescript",
  imports: [],
  functions: [],
  classes: [],
});

test("AST reference search separates definitions, imports, calls and references", () => {
  const report = findAstSymbolReferences([
    file("src/a.ts", "export function normalizeId(value: string) { return value; }"),
    file("src/b.ts", [
      'import { normalizeId } from "./a.js";',
      "const id = normalizeId('value');",
      "const callback = normalizeId;",
      'const text = "normalizeId() is documentation";',
      "// normalizeId() in a comment",
    ].join("\n")),
  ], "normalizeId");

  assert.equal(report.definitions.length, 1);
  assert.equal(report.definitions[0]?.source, "src/a.ts");
  assert.deepEqual(report.references.map((item) => item.kind), ["import", "call", "reference"]);
  assert.ok(report.references.every((item) => !/documentation|comment/.test(item.text)));
});

test("AST reference search does not confuse similarly named identifiers", () => {
  const report = findAstSymbolReferences([
    file("src/example.ts", "const normalizeIdentifier = () => 1; normalizeIdentifier();"),
  ], "normalizeId");
  assert.equal(report.definitions.length, 0);
  assert.equal(report.references.length, 0);
});

