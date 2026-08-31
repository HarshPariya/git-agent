import fs from "node:fs/promises";
import path from "node:path";
import type {
  ReadFileInput,
  ReadFileOutput,
  ToolDefinition,
  ToolPermission,
} from "../types/tools.js";

const DEFAULT_PERMISSIONS: readonly ToolPermission[] = ["read"];
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_LINES_LIMIT = 500;
const MAX_FILE_BYTES = 50_000;
const SENSITIVE_PATTERNS = [/\.env/i, /\.key$/i, /\.pem$/i, /id_rsa/i];

const parameters = {
  type: "object",
  properties: {
    path: {
      type: "string",
      description: "Relative path to the file to read (e.g. 'src/agent/orchestrator.ts').",
    },
    startLine: {
      description: "Optional 1-indexed starting line number.",
    },
    endLine: {
      description: "Optional 1-indexed ending line number.",
    },
  },
  required: ["path"],
  additionalProperties: false,
} as const;

const sanitizePath = (baseDir: string, requestedPath: string): string => {
  const containsNull = requestedPath.includes("\0");
  containsNull && (() => { throw new Error("Path contains illegal null bytes"); })();

  const isSensitive = SENSITIVE_PATTERNS.some((pattern) => pattern.test(requestedPath));
  isSensitive && (() => { throw new Error("Access denied: reading sensitive file is prohibited"); })();

  const resolved = path.resolve(baseDir, requestedPath);
  const relative = path.relative(baseDir, resolved);
  const isEscaping = relative.startsWith("..") || path.isAbsolute(relative);
  isEscaping && (() => { throw new Error("Access denied: path escapes workspace root"); })();

  return resolved;
};

const parseInput = (input: unknown): ReadFileInput => {
  const isObject = typeof input === "object" && input !== null && !Array.isArray(input);
  !isObject && (() => { throw new Error("Invalid read_file input"); })();

  const data = input as Record<string, unknown>;
  const rawPath = typeof data.path === "string" ? data.path.trim() : "";
  !rawPath && (() => { throw new Error("File path is required"); })();

  const rawStart = typeof data.startLine === "number" ? data.startLine : Number(data.startLine);
  const startLine = !isNaN(rawStart) && rawStart > 0 ? rawStart : undefined;

  const rawEnd = typeof data.endLine === "number" ? data.endLine : Number(data.endLine);
  const endLine = !isNaN(rawEnd) && rawEnd > 0 ? rawEnd : undefined;

  return {
    path: rawPath,
    ...(startLine !== undefined && { startLine }),
    ...(endLine !== undefined && { endLine }),
  };
};

export const createReadFileTool = (
  baseDir: string = process.cwd(),
): ToolDefinition<ReadFileInput, ReadFileOutput> => ({
  name: "read_file",
  description: "Reads the text contents of a file in the workspace. Supports optional line range slicing.",
  parameters,
  permissions: DEFAULT_PERMISSIONS,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  parseInput,
  execute: async ({ input }) => {
    const filePath = sanitizePath(baseDir, input.path);
    const rawContent = await fs.readFile(filePath, "utf8");
    const boundedContent = rawContent.slice(0, MAX_FILE_BYTES);
    const lines = boundedContent.split("\n");
    const totalLines = lines.length;

    const start = Math.max(1, input.startLine ?? 1);
    const end = Math.min(totalLines, input.endLine ?? Math.min(totalLines, start + MAX_LINES_LIMIT - 1));
    const selectedLines = lines.slice(start - 1, end);

    return {
      path: input.path,
      totalLines,
      linesReturned: selectedLines.length,
      content: selectedLines.join("\n"),
    };
  },
});
