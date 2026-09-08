import ts from "typescript";
import type { ParsedImport, ParsedFunction, ParsedClass } from "./parser.js";

export interface ASTParseResult { imports: ParsedImport[]; functions: ParsedFunction[]; classes: ParsedClass[]; }

export function parseTypeScriptAST(content: string, filePath: string): ASTParseResult {
  const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
  const imports: ParsedImport[] = [];
  const functions: ParsedFunction[] = [];
  const classes: ParsedClass[] = [];
  const getLineNumber = (pos: number) => sourceFile.getLineAndCharacterOfPosition(pos).line + 1;
  const getNodeContent = (node: ts.Node) => node.getText(sourceFile);

  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node)) {
      const moduleSpecifier = (node.moduleSpecifier as ts.StringLiteral).text;
      const names: string[] = [];
      if (node.importClause) {
        if (node.importClause.name) names.push(node.importClause.name.getText(sourceFile));
        if (node.importClause.namedBindings) {
          if (ts.isNamedImports(node.importClause.namedBindings)) { for (const element of node.importClause.namedBindings.elements) names.push(element.name.getText(sourceFile)); }
          else if (ts.isNamespaceImport(node.importClause.namedBindings)) names.push(node.importClause.namedBindings.name.getText(sourceFile));
        }
      }
      imports.push({ source: moduleSpecifier, names, line: getLineNumber(node.getStart()) });
    } else if (ts.isFunctionDeclaration(node) && node.name) {
      functions.push({ name: node.name.getText(sourceFile), startLine: getLineNumber(node.getStart()), endLine: getLineNumber(node.getEnd()), content: getNodeContent(node) });
    } else if (ts.isVariableDeclaration(node) && node.name && node.initializer) {
      if (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) {
        functions.push({ name: node.name.getText(sourceFile), startLine: getLineNumber(node.getStart()), endLine: getLineNumber(node.getEnd()), content: getNodeContent(node.parent?.parent ?? node) });
      }
    } else if (ts.isClassDeclaration(node) && node.name) {
      const className = node.name.getText(sourceFile);
      classes.push({ name: className, startLine: getLineNumber(node.getStart()), endLine: getLineNumber(node.getEnd()), content: getNodeContent(node) });
      for (const member of node.members) {
        if (ts.isMethodDeclaration(member) && member.name) {
          functions.push({ name: `${className}.${member.name.getText(sourceFile)}`, startLine: getLineNumber(member.getStart()), endLine: getLineNumber(member.getEnd()), content: getNodeContent(member) });
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return { imports, functions, classes };
}
