import fs from "node:fs/promises";
import path from "node:path";
import { isIgnoredDirectory, isIgnoredFile, isPathWithinRoot, MAX_FILE_SIZE_BYTES } from "./cleaner.js";
import { parseTypeScriptAST } from "./ast-parser.js";

export type SupportedLanguage = "typescript" | "javascript" | "python" | "json" | "unknown";
export interface ParsedImport { source: string; names: string[]; line: number; }
export interface ParsedFunction { name: string; startLine: number; endLine: number; content: string; }
export interface ParsedClass { name: string; startLine: number; endLine: number; content: string; }
export interface ParsedFile { filePath: string; language: SupportedLanguage; content: string; imports: ParsedImport[]; functions: ParsedFunction[]; classes: ParsedClass[]; }

const SUPPORTED_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".json", ".html", ".css", ".md", ".sql", ".yml", ".yaml"]);

export function detectLanguage(filePath: string): SupportedLanguage {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".ts" || ext === ".tsx") return "typescript";
  if (ext === ".js" || ext === ".jsx" || ext === ".mjs" || ext === ".cjs") return "javascript";
  if (ext === ".py") return "python";
  if (ext === ".json") return "json";
  return "unknown";
}

function findBlockEnd(lines: string[], startIndex: number): number {
  let braceDepth = 0, started = false;
  for (let index = startIndex; index < lines.length; index++) {
    const line = lines[index]; if (!line) continue;
    for (const ch of line) { if (ch === "{") { braceDepth++; started = true; } if (ch === "}") braceDepth--; }
    if (started && braceDepth === 0) return index;
  }
  return startIndex;
}

function extractImports(lines: string[], language: SupportedLanguage): ParsedImport[] {
  const imports: ParsedImport[] = [];
  if (language === "typescript" || language === "javascript") {
    lines.forEach((line, index) => {
      const trimmed = line.trim();
      const fromMatch = trimmed.match(/^import\s+(.+?)\s+from\s+["'](.+?)["']/);
      if (fromMatch?.[1] && fromMatch[2]) { imports.push({ source: fromMatch[2], names: fromMatch[1].replace(/[{}]/g, "").split(",").map((n) => n.trim()).filter(Boolean), line: index + 1 }); return; }
      const sideEffectMatch = trimmed.match(/^import\s+["'](.+?)["']/);
      if (sideEffectMatch?.[1]) imports.push({ source: sideEffectMatch[1], names: [], line: index + 1 });
    });
  }
  if (language === "python") {
    lines.forEach((line, index) => {
      const trimmed = line.trim();
      const fromMatch = trimmed.match(/^from\s+([\w.]+)\s+import\s+(.+)$/);
      if (fromMatch?.[1] && fromMatch[2]) { imports.push({ source: fromMatch[1], names: fromMatch[2].split(",").map((n) => n.trim()).filter(Boolean), line: index + 1 }); return; }
      const importMatch = trimmed.match(/^import\s+(.+)$/);
      if (importMatch?.[1]) { for (const moduleName of importMatch[1].split(",").map((n) => n.trim()).filter(Boolean)) imports.push({ source: moduleName, names: [], line: index + 1 }); }
    });
  }
  return imports;
}

export function extractJavaScriptFunctions(lines: string[]): ParsedFunction[] {
  const functions: ParsedFunction[] = [];
  const patterns = [/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/, /^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/, /^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?[A-Za-z_$][\w$]*\s*=>/];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]; if (!line) continue;
    for (const pattern of patterns) {
      const match = line.trim().match(pattern);
      if (!match?.[1]) continue;
      const endIndex = findBlockEnd(lines, index);
      functions.push({ name: match[1], startLine: index + 1, endLine: endIndex + 1, content: lines.slice(index, endIndex + 1).join("\n") });
      break;
    }
  }
  return functions;
}

function extractPythonFunctions(lines: string[]): ParsedFunction[] {
  const functions: ParsedFunction[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]; if (!line) continue;
    const match = line.match(/^(\s*)def\s+([A-Za-z_]\w*)\s*\(/);
    if (!match?.[1] || !match[2]) continue;
    const indentation = match[1].length;
    let endIndex = index;
    for (let nextIndex = index + 1; nextIndex < lines.length; nextIndex++) {
      const nextLine = lines[nextIndex]; if (!nextLine) break;
      if (nextLine.trim() === "") { endIndex = nextIndex; continue; }
      const nextIndentation = nextLine.match(/^\s*/)?.[0]?.length ?? 0;
      if (nextIndentation <= indentation) break;
      endIndex = nextIndex;
    }
    functions.push({ name: match[2], startLine: index + 1, endLine: endIndex + 1, content: lines.slice(index, endIndex + 1).join("\n") });
  }
  return functions;
}

export function extractJavaScriptClasses(lines: string[]): ParsedClass[] {
  const classes: ParsedClass[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]; if (!line) continue;
    const match = line.trim().match(/^(?:export\s+)?(?:default\s+)?class\s+([A-Za-z_$][\w$]*)/);
    if (!match?.[1]) continue;
    const endIndex = findBlockEnd(lines, index);
    classes.push({ name: match[1], startLine: index + 1, endLine: endIndex + 1, content: lines.slice(index, endIndex + 1).join("\n") });
  }
  return classes;
}

function extractPythonClasses(lines: string[]): ParsedClass[] {
  const classes: ParsedClass[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]; if (!line) continue;
    const match = line.match(/^(\s*)class\s+([A-Za-z_]\w*)/);
    if (!match?.[1] || !match[2]) continue;
    const indentation = match[1].length;
    let endIndex = index;
    for (let nextIndex = index + 1; nextIndex < lines.length; nextIndex++) {
      const nextLine = lines[nextIndex]; if (!nextLine) break;
      if (nextLine.trim() === "") { endIndex = nextIndex; continue; }
      const nextIndentation = nextLine.match(/^\s*/)?.[0]?.length ?? 0;
      if (nextIndentation <= indentation) break;
      endIndex = nextIndex;
    }
    classes.push({ name: match[2], startLine: index + 1, endLine: endIndex + 1, content: lines.slice(index, endIndex + 1).join("\n") });
  }
  return classes;
}

export async function parseFile(filePath: string): Promise<ParsedFile> {
  const absolutePath = path.resolve(filePath);
  const content = await fs.readFile(absolutePath, "utf8");
  const language = detectLanguage(filePath);
  const lines = content.split(/\r?\n/);
  let imports: ParsedImport[] = [], functions: ParsedFunction[] = [], classes: ParsedClass[] = [];
  if (language === "typescript" || language === "javascript") { const astResult = parseTypeScriptAST(content, filePath); imports = astResult.imports; functions = astResult.functions; classes = astResult.classes; }
  else if (language === "python") { imports = extractImports(lines, language); functions = extractPythonFunctions(lines); classes = extractPythonClasses(lines); }
  else imports = extractImports(lines, language);
  return { filePath: path.normalize(filePath), language, content, imports, functions, classes };
}

export async function scanRepository(rootDirectory: string): Promise<string[]> {
  const resolvedRoot = path.resolve(rootDirectory);
  const files: string[] = [];
  async function walk(directory: string): Promise<void> {
    if (!isPathWithinRoot(directory, resolvedRoot) && directory !== resolvedRoot) { console.warn(`🛡 Security: Blocked path traversal walk outside root: ${directory}`); return; }
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (!isPathWithinRoot(path.resolve(fullPath), resolvedRoot)) { console.warn(`🛡 Security: Blocked out-of-root file: ${path.resolve(fullPath)}`); continue; }
      if (entry.isDirectory()) { if (isIgnoredDirectory(entry.name)) continue; await walk(fullPath); continue; }
      if (!entry.isFile()) continue;
      if (isIgnoredFile(entry.name)) { console.log(`🛡 Security: Filtered secret/artifact file: ${entry.name}`); continue; }
      try { const stat = await fs.stat(fullPath); if (stat.size > MAX_FILE_SIZE_BYTES) { console.warn(`🛡 Security: Skipped oversized file (${(stat.size / 1024 / 1024).toFixed(2)} MB): ${fullPath}`); continue; } }
      catch { continue; }
      if (SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(fullPath);
    }
  }
  await walk(resolvedRoot);
  return files.sort();
}

export async function parseRepository(rootDirectory: string): Promise<ParsedFile[]> {
  const files = await scanRepository(rootDirectory);
  const parsedFiles: ParsedFile[] = [];
  for (const file of files) parsedFiles.push(await parseFile(file));
  return parsedFiles;
}
