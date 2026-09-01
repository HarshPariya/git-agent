import fs from "node:fs/promises";
import path from "node:path";
import type {
  DirectoryEntry,
  ListDirectoryInput,
  ListDirectoryOutput,
  ToolDefinition,
  ToolPermission,
} from "../types/tools.js";

const DEFAULT_PERMISSIONS: readonly ToolPermission[] = ["read"];
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_ALLOWED_ENTRIES = 200;
const BLOCKED_NAMES = new Set([
  ".git",
  "node_modules",
  ".env",
  ".env.local",
  "dist",
  ".turbo",
  ".next",
]);

const parameters = {
  type: "object",
  properties: {
    path: {
      type: "string",
      description: "Relative directory path within the project (e.g. 'src/agent', 'src', '.'). Defaults to '.'",
    },
    recursive: {
      description: "Whether to list subdirectories recursively (max depth 2). Accepts true/false.",
    },
    maxEntries: {
      description: "Maximum number of entries to return (default 200).",
    },
  },
  additionalProperties: false,
} as const;

const sanitizePath = (baseDir: string, requestedPath: string): string => {
  const containsNull = requestedPath.includes("\0");
  containsNull && (() => { throw new Error("Path contains illegal null bytes"); })();

  const resolved = path.resolve(baseDir, requestedPath);
  const relative = path.relative(baseDir, resolved);
  const isEscaping = relative.startsWith("..") || path.isAbsolute(relative);
  isEscaping && (() => { throw new Error("Access denied: path escapes workspace root"); })();

  return resolved;
};

const parseInput = (input: unknown): ListDirectoryInput => {
  const data = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const requestedPath = typeof data.path === "string" && data.path.trim() ? data.path.trim() : ".";
  const recursive = data.recursive === true || String(data.recursive).toLowerCase() === "true";
  const rawMax = typeof data.maxEntries === "number" ? data.maxEntries : Number(data.maxEntries);
  const maxEntries = !isNaN(rawMax) && rawMax > 0 ? Math.min(rawMax, MAX_ALLOWED_ENTRIES) : MAX_ALLOWED_ENTRIES;

  return { path: requestedPath, recursive, maxEntries };
};

const scanDirectory = async (
  baseDir: string,
  targetDir: string,
  recursive: boolean,
  maxEntries: number,
  currentDepth: number = 0,
): Promise<DirectoryEntry[]> => {
  const results: DirectoryEntry[] = [];
  const entries = await fs.readdir(targetDir, { withFileTypes: true });

  for (const entry of entries) {
    if (results.length >= maxEntries) break;
    if (BLOCKED_NAMES.has(entry.name)) continue;

    const fullPath = path.join(targetDir, entry.name);
    const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, "/");

    if (entry.isDirectory()) {
      results.push({ name: entry.name, relativePath, type: "directory" });
      if (recursive && currentDepth < 2) {
        const nested = await scanDirectory(baseDir, fullPath, recursive, maxEntries - results.length, currentDepth + 1);
        results.push(...nested);
      }
    } else if (entry.isFile()) {
      results.push({ name: entry.name, relativePath, type: "file" });
    }
  }

  return results;
};

export const createListDirectoryTool = (
  baseDir: string = process.cwd(),
): ToolDefinition<ListDirectoryInput, ListDirectoryOutput> => ({
  name: "list_directory",
  description: "Lists files and subdirectories within a project directory.",
  parameters,
  permissions: DEFAULT_PERMISSIONS,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  parseInput,
  execute: async ({ input }) => {
    const targetDir = sanitizePath(baseDir, input.path ?? ".");
    const entries = await scanDirectory(
      baseDir,
      targetDir,
      input.recursive ?? false,
      input.maxEntries ?? MAX_ALLOWED_ENTRIES,
    );

    return {
      path: input.path ?? ".",
      totalEntries: entries.length,
      entries,
    };
  },
});
