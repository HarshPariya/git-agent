import fs from "node:fs/promises";
import path from "node:path";
import { isIgnoredDirectory, isIgnoredFile, isPathWithinRoot, MAX_FILE_SIZE_BYTES } from "./cleaner.js";
import { parseTypeScriptAST } from "./ast-parser.js";

export type SupportedLanguage = "typescript" | "javascript" | "python" | "json" | "unknown";

export interface ParsedImport {
  source: string;
  names: string[];
  line: number;
}

export interface ParsedFunction {
  name: string;
  startLine: number;
  endLine: number;
  content: string;
}

export interface ParsedClass {
  name: string;
  startLine: number;
  endLine: number;
  content: string;
}

export interface ParsedFile {
  filePath: string;
  language: SupportedLanguage;
  content: string;
  imports: ParsedImport[];
  functions: ParsedFunction[];
  classes: ParsedClass[];
}

const SUPPORTED_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".json", ".html", ".css", ".md", ".sql", ".yml", ".yaml"]);

const LANG_MAP: Record<string, SupportedLanguage> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".json": "json",
};

export const detectLanguage = (filePath: string): SupportedLanguage =>
  LANG_MAP[path.extname(filePath).toLowerCase()] ?? "unknown";

const findBlockEnd = (lines: string[], startIndex: number): number => {
  let braceDepth = 0;
  let started = false;
  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    for (const ch of line) {
      if (ch === "{") { braceDepth++; started = true; }
      if (ch === "}") braceDepth--;
    }
    if (started && braceDepth === 0) return i;
  }
  return startIndex;
};

const findIndentBlockEnd = (lines: string[], startIndex: number, indentation: number): number => {
  let endIndex = startIndex;
  for (let i = startIndex + 1; i < lines.length; i++) {
    const nextLine = lines[i];
    if (!nextLine) break;
    if (nextLine.trim() === "") { endIndex = i; continue; }
    const nextIndent = nextLine.match(/^\s*/)?.[0]?.length ?? 0;
    if (nextIndent <= indentation) break;
    endIndex = i;
  }
  return endIndex;
};

const extractTSImports = (lines: string[]): ParsedImport[] =>
  lines.flatMap((line, index) => {
    const trimmed = line.trim();
    const fromMatch = trimmed.match(/^import\s+(.+?)\s+from\s+["'](.+?)["']/);
    if (fromMatch?.[1] && fromMatch[2])
      return [{ source: fromMatch[2], names: fromMatch[1].replace(/[{}]/g, "").split(",").map((n) => n.trim()).filter(Boolean), line: index + 1 }];
    const sideEffect = trimmed.match(/^import\s+["'](.+?)["']/);
    return sideEffect?.[1] ? [{ source: sideEffect[1], names: [], line: index + 1 }] : [];
  });

const extractPyImports = (lines: string[]): ParsedImport[] =>
  lines.flatMap((line, index) => {
    const trimmed = line.trim();
    const fromMatch = trimmed.match(/^from\s+([\w.]+)\s+import\s+(.+)$/);
    if (fromMatch?.[1] && fromMatch[2])
      return [{ source: fromMatch[1], names: fromMatch[2].split(",").map((n) => n.trim()).filter(Boolean), line: index + 1 }];
    const importMatch = trimmed.match(/^import\s+(.+)$/);
    return importMatch?.[1]
      ? importMatch[1].split(",").map((n) => n.trim()).filter(Boolean).map((source) => ({ source, names: [], line: index + 1 }))
      : [];
  });

const extractImports = (lines: string[], language: SupportedLanguage): ParsedImport[] => {
  const extractors: Partial<Record<SupportedLanguage, typeof extractTSImports>> = {
    typescript: extractTSImports,
    javascript: extractTSImports,
    python: extractPyImports,
  };
  return (extractors[language] ?? (() => []))(lines);
};

const JS_FUNC_PATTERNS = [
  /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/,
  /^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/,
  /^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?[A-Za-z_$][\w$]*\s*=>/,
];

export const extractJavaScriptFunctions = (lines: string[]): ParsedFunction[] =>
  lines.flatMap((line, index) => {
    const trimmed = line?.trim();
    const match = trimmed && JS_FUNC_PATTERNS.map((p) => trimmed.match(p)).find(Boolean);
    if (!match?.[1]) return [];
    const end = findBlockEnd(lines, index);
    return [{ name: match[1], startLine: index + 1, endLine: end + 1, content: lines.slice(index, end + 1).join("\n") }];
  });

const extractPythonFunctions = (lines: string[]): ParsedFunction[] =>
  lines.flatMap((line, index) => {
    const match = line?.match(/^(\s*)def\s+([A-Za-z_]\w*)\s*\(/);
    if (!match?.[1] || !match[2]) return [];
    const end = findIndentBlockEnd(lines, index, match[1].length);
    return [{ name: match[2], startLine: index + 1, endLine: end + 1, content: lines.slice(index, end + 1).join("\n") }];
  });

export const extractJavaScriptClasses = (lines: string[]): ParsedClass[] =>
  lines.flatMap((line, index) => {
    const match = line?.trim().match(/^(?:export\s+)?(?:default\s+)?class\s+([A-Za-z_$][\w$]*)/);
    if (!match?.[1]) return [];
    const end = findBlockEnd(lines, index);
    return [{ name: match[1], startLine: index + 1, endLine: end + 1, content: lines.slice(index, end + 1).join("\n") }];
  });

const extractPythonClasses = (lines: string[]): ParsedClass[] =>
  lines.flatMap((line, index) => {
    const match = line?.match(/^(\s*)class\s+([A-Za-z_]\w*)/);
    if (!match?.[1] || !match[2]) return [];
    const end = findIndentBlockEnd(lines, index, match[1].length);
    return [{ name: match[2], startLine: index + 1, endLine: end + 1, content: lines.slice(index, end + 1).join("\n") }];
  });

const parseByLanguage = (filePath: string, language: SupportedLanguage, content: string): { imports: ParsedImport[]; functions: ParsedFunction[]; classes: ParsedClass[] } => {
  if (language === "typescript" || language === "javascript") return parseTypeScriptAST(content, filePath);
  if (language === "python") {
    const lines = content.split(/\r?\n/);
    return {
      imports: extractImports(lines, language),
      functions: extractPythonFunctions(lines),
      classes: extractPythonClasses(lines),
    };
  }
  const lines = content.split(/\r?\n/);
  return { imports: extractImports(lines, language), functions: [], classes: [] };
};

export const parseFile = async (filePath: string): Promise<ParsedFile> => {
  const absolutePath = path.resolve(filePath);
  const content = await fs.readFile(absolutePath, "utf8");
  const language = detectLanguage(filePath);
  const { imports, functions, classes } = parseByLanguage(filePath, language, content);
  return { filePath: path.normalize(filePath), language, content, imports, functions, classes };
};

export const scanRepository = async (rootDirectory: string): Promise<string[]> => {
  const resolvedRoot = path.resolve(rootDirectory);
  const files: string[] = [];

  const walk = async (directory: string): Promise<void> => {
    if (!isPathWithinRoot(directory, resolvedRoot) && directory !== resolvedRoot) {
      console.warn(`🛡 Security: Blocked path traversal walk outside root: ${directory}`);
      return;
    }

    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      const resolved = path.resolve(fullPath);

      if (!isPathWithinRoot(resolved, resolvedRoot)) {
        console.warn(`🛡 Security: Blocked out-of-root file: ${resolved}`);
        continue;
      }

      if (entry.isDirectory()) {
        if (!isIgnoredDirectory(entry.name)) await walk(fullPath);
        continue;
      }

      if (!entry.isFile()) continue;
      if (isIgnoredFile(entry.name)) { console.log(`🛡 Security: Filtered secret/artifact file: ${entry.name}`); continue; }

      let stat;
      try {
        stat = await fs.stat(fullPath);
      } catch {
        continue;
      }

      if (stat.size > MAX_FILE_SIZE_BYTES) {
        console.warn(`🛡 Security: Skipped oversized file (${(stat.size / 1024 / 1024).toFixed(2)} MB): ${fullPath}`);
        continue;
      }

      if (SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(fullPath);
    }
  };

  await walk(resolvedRoot);
  return files.sort();
};

export const parseRepository = async (rootDirectory: string): Promise<ParsedFile[]> => {
  const files = await scanRepository(rootDirectory);
  return Promise.all(files.map((file) => parseFile(file)));
};
