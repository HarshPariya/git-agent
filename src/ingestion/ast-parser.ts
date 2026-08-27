import ts from "typescript";
import type {
  ParsedImport,
  ParsedFunction,
  ParsedClass,
} from "./parser.js";

export interface ASTParseResult {
  imports: ParsedImport[];
  functions: ParsedFunction[];
  classes: ParsedClass[];
}

export function parseTypeScriptAST(
  content: string,
  filePath: string,
): ASTParseResult {
  const scriptTarget = ts.ScriptTarget.Latest;
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    scriptTarget,
    true, // setParentNodes
  );

  const imports: ParsedImport[] = [];
  const functions: ParsedFunction[] = [];
  const classes: ParsedClass[] = [];

  function getLineNumber(pos: number): number {
    return sourceFile.getLineAndCharacterOfPosition(pos).line + 1;
  }

  function getNodeContent(node: ts.Node): string {
    return node.getText(sourceFile);
  }

  function visit(node: ts.Node) {
    // 1. Imports
    if (ts.isImportDeclaration(node)) {
      const moduleSpecifier = (node.moduleSpecifier as ts.StringLiteral).text;
      const names: string[] = [];

      if (node.importClause) {
        if (node.importClause.name) {
          names.push(node.importClause.name.getText(sourceFile));
        }

        if (node.importClause.namedBindings) {
          if (ts.isNamedImports(node.importClause.namedBindings)) {
            for (const element of node.importClause.namedBindings.elements) {
              names.push(element.name.getText(sourceFile));
            }
          } else if (ts.isNamespaceImport(node.importClause.namedBindings)) {
            names.push(node.importClause.namedBindings.name.getText(sourceFile));
          }
        }
      }

      imports.push({
        source: moduleSpecifier,
        names,
        line: getLineNumber(node.getStart()),
      });
    }

    // 2. Function Declarations
    else if (ts.isFunctionDeclaration(node) && node.name) {
      const name = node.name.getText(sourceFile);
      const startLine = getLineNumber(node.getStart());
      const endLine = getLineNumber(node.getEnd());

      functions.push({
        name,
        startLine,
        endLine,
        content: getNodeContent(node),
      });
    }

    // 3. Arrow Function / Function Expression Variable Declarations
    else if (ts.isVariableDeclaration(node) && node.name && node.initializer) {
      if (
        ts.isArrowFunction(node.initializer) ||
        ts.isFunctionExpression(node.initializer)
      ) {
        const name = node.name.getText(sourceFile);
        const startLine = getLineNumber(node.getStart());
        const endLine = getLineNumber(node.getEnd());

        functions.push({
          name,
          startLine,
          endLine,
          content: getNodeContent(node.parent?.parent ?? node),
        });
      }
    }

    // 4. Class Declarations & Methods
    else if (ts.isClassDeclaration(node) && node.name) {
      const className = node.name.getText(sourceFile);
      const classStartLine = getLineNumber(node.getStart());
      const classEndLine = getLineNumber(node.getEnd());

      classes.push({
        name: className,
        startLine: classStartLine,
        endLine: classEndLine,
        content: getNodeContent(node),
      });

      // Extract class methods as functions
      for (const member of node.members) {
        if (ts.isMethodDeclaration(member) && member.name) {
          const methodName = member.name.getText(sourceFile);
          const methodStartLine = getLineNumber(member.getStart());
          const methodEndLine = getLineNumber(member.getEnd());

          functions.push({
            name: `${className}.${methodName}`,
            startLine: methodStartLine,
            endLine: methodEndLine,
            content: getNodeContent(member),
          });
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  return {
    imports,
    functions,
    classes,
  };
}
