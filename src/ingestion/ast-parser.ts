import ts from "typescript";
import type { ParsedImport, ParsedFunction, ParsedClass } from "./parser.js";

export interface ASTParseResult {
  imports: ParsedImport[];
  functions: ParsedFunction[];
  classes: ParsedClass[];
}

export const parseTypeScriptAST = (content: string, filePath: string): ASTParseResult => {
  const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
  const imports: ParsedImport[] = [];
  const functions: ParsedFunction[] = [];
  const classes: ParsedClass[] = [];

  const getLineNumber = (pos: number) => sourceFile.getLineAndCharacterOfPosition(pos).line + 1;
  const getNodeContent = (node: ts.Node) => node.getText(sourceFile);
  const pushFunction = (node: ts.Node, name: string, containerNode?: ts.Node) =>
    functions.push({
      name,
      startLine: getLineNumber(node.getStart()),
      endLine: getLineNumber(node.getEnd()),
      content: getNodeContent(containerNode ?? node),
    });

  const extractNamedImports = (bindings: ts.NamedImportBindings): string[] =>
    ts.isNamedImports(bindings)
      ? bindings.elements.map((el) => el.name.getText(sourceFile))
      : ts.isNamespaceImport(bindings)
        ? [bindings.name.getText(sourceFile)]
        : [];

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      const names = node.importClause
        ? [
            node.importClause.name?.getText(sourceFile),
            ...(node.importClause.namedBindings ? extractNamedImports(node.importClause.namedBindings) : []),
          ].filter((n): n is string => n !== undefined)
        : [];

      imports.push({
        source: (node.moduleSpecifier as ts.StringLiteral).text,
        names,
        line: getLineNumber(node.getStart()),
      });
      ts.forEachChild(node, visit);
      return;
    }

    if (ts.isFunctionDeclaration(node) && node.name) {
      pushFunction(node, node.name.getText(sourceFile));
      ts.forEachChild(node, visit);
      return;
    }

    if (ts.isVariableDeclaration(node) && node.name) {
      const isFuncExpr =
        node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer));
      if (isFuncExpr) pushFunction(node, node.name.getText(sourceFile), node.parent?.parent ?? node);
      ts.forEachChild(node, visit);
      return;
    }

    if (ts.isClassDeclaration(node) && node.name) {
      const className = node.name.getText(sourceFile);
      classes.push({
        name: className,
        startLine: getLineNumber(node.getStart()),
        endLine: getLineNumber(node.getEnd()),
        content: getNodeContent(node),
      });

      node.members
        .filter((m): m is ts.MethodDeclaration => ts.isMethodDeclaration(m) && m.name !== undefined)
        .forEach((member) => pushFunction(member, `${className}.${member.name.getText(sourceFile)}`));
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return { imports, functions, classes };
};
