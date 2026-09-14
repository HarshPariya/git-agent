import ts from "typescript";
import type { ParsedFile } from "../ingestion/parser.js";
import type { SymbolReferenceEvidence, SymbolReferenceKind, SymbolReferenceReport } from "./types.js";

const definitionParents: readonly ((node: ts.Node) => node is ts.Declaration)[] = [
  ts.isFunctionDeclaration,
  ts.isClassDeclaration,
  ts.isInterfaceDeclaration,
  ts.isTypeAliasDeclaration,
  ts.isVariableDeclaration,
  ts.isMethodDeclaration,
];

const isDefinitionIdentifier = (node: ts.Identifier): boolean => {
  const { parent } = node;
  return definitionParents.some((check) => check(parent)) && (parent as ts.NamedDeclaration).name === node;
};

const isImportIdentifier = (node: ts.Identifier): boolean =>
  ts.isImportSpecifier(node.parent) ||
  ts.isImportClause(node.parent) ||
  ts.isNamespaceImport(node.parent) ||
  ts.isImportEqualsDeclaration(node.parent);

const referenceKind = (node: ts.Identifier): SymbolReferenceKind => {
  if (isDefinitionIdentifier(node)) return "definition";
  if (isImportIdentifier(node)) return "import";
  const { parent } = node;
  if (
    (ts.isCallExpression(parent) && parent.expression === node) ||
    (ts.isPropertyAccessExpression(parent) && parent.name === node && ts.isCallExpression(parent.parent))
  )
    return "call";
  return "reference";
};

const sortEvidence = (a: SymbolReferenceEvidence, b: SymbolReferenceEvidence): number =>
  a.source.localeCompare(b.source) || a.line - b.line || a.column - b.column;

export const findAstSymbolReferences = (files: readonly ParsedFile[], symbol: string): SymbolReferenceReport => {
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
        const normalizedPath = file.filePath.replace(/\\/g, "/");
        const evidence: SymbolReferenceEvidence = {
          symbol,
          kind,
          source: normalizedPath,
          line: location.line + 1,
          column: location.character + 1,
          text: lines[location.line]?.trim() ?? node.getText(sourceFile),
        };
        const key = `${evidence.source}:${evidence.line}:${evidence.column}:${kind}`;

        if (!seen.has(key)) {
          seen.add(key);
          (kind === "definition" ? definitions : references).push(evidence);
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
  }

  return {
    symbol,
    definitions: definitions.sort(sortEvidence),
    references: references.sort(sortEvidence),
  };
};
