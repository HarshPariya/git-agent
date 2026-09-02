import ts from "typescript";

import type { ParsedFile } from "../ingestion/parser.js";
import type {
  SymbolReferenceEvidence,
  SymbolReferenceKind,
  SymbolReferenceReport,
} from "./types.js";

function isDefinitionIdentifier(node: ts.Identifier): boolean {
  const parent = node.parent;
  return (
    (ts.isFunctionDeclaration(parent) || ts.isClassDeclaration(parent) ||
      ts.isInterfaceDeclaration(parent) || ts.isTypeAliasDeclaration(parent) ||
      ts.isVariableDeclaration(parent) || ts.isMethodDeclaration(parent)) &&
    parent.name === node
  );
}

function isImportIdentifier(node: ts.Identifier): boolean {
  return ts.isImportSpecifier(node.parent) || ts.isImportClause(node.parent) ||
    ts.isNamespaceImport(node.parent) || ts.isImportEqualsDeclaration(node.parent);
}

function referenceKind(node: ts.Identifier): SymbolReferenceKind {
  if (isDefinitionIdentifier(node)) return "definition";
  if (isImportIdentifier(node)) return "import";
  const parent = node.parent;
  if (
    (ts.isCallExpression(parent) && parent.expression === node) ||
    (ts.isPropertyAccessExpression(parent) && parent.name === node && ts.isCallExpression(parent.parent))
  ) {
    return "call";
  }
  return "reference";
}

export function findAstSymbolReferences(
  files: readonly ParsedFile[],
  symbol: string,
): SymbolReferenceReport {
  const definitions: SymbolReferenceEvidence[] = [];
  const references: SymbolReferenceEvidence[] = [];
  const seen = new Set<string>();

  for (const file of files) {
    if (file.language !== "typescript" && file.language !== "javascript") continue;
    const sourceFile = ts.createSourceFile(file.filePath, file.content, ts.ScriptTarget.Latest, true);
    const lines = file.content.split(/\r?\n/);
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node) && node.text === symbol) {
        const location = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        const kind = referenceKind(node);
        const evidence: SymbolReferenceEvidence = {
          symbol,
          kind,
          source: file.filePath.replace(/\\/g, "/"),
          line: location.line + 1,
          column: location.character + 1,
          text: lines[location.line]?.trim() ?? node.getText(sourceFile),
        };
        const key = `${evidence.source}:${evidence.line}:${evidence.column}:${kind}`;
        if (!seen.has(key)) {
          seen.add(key);
          if (kind === "definition") definitions.push(evidence);
          else references.push(evidence);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  const byLocation = (a: SymbolReferenceEvidence, b: SymbolReferenceEvidence): number =>
    a.source.localeCompare(b.source) || a.line - b.line || a.column - b.column;
  return {
    symbol,
    definitions: definitions.sort(byLocation),
    references: references.sort(byLocation),
  };
}
