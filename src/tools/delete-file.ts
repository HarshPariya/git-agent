import fs from "node:fs/promises";
import path from "node:path";
import type {
  DeleteFileInput,
  DeleteFileOutput,
  ToolDefinition,
  ToolPermission,
} from "../types/tools.js";

const DEFAULT_PERMISSIONS: readonly ToolPermission[] = ["write"];
const DEFAULT_TIMEOUT_MS = 10_000;
const PROTECTED_FILES = new Set([
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "tsconfig_2.json",
  ".env",
  ".env.local",
  ".gitignore",
]);

const parameters = {
  type: "object",
  properties: {
    path: {
      type: "string",
      description: "Relative path of the file to delete (e.g. 'src/agent/temp.ts').",
    },
  },
  required: ["path"],
  additionalProperties: false,
} as const;

const sanitizePath = (baseDir: string, requestedPath: string): string => {
  const containsNull = requestedPath.includes("\0");
  containsNull && (() => { throw new Error("Path contains illegal null bytes"); })();

  const filename = path.basename(requestedPath);
  const isProtected = PROTECTED_FILES.has(filename) || filename.startsWith(".env");
  isProtected && (() => { throw new Error("Access denied: deleting protected project file is prohibited"); })();

  const resolved = path.resolve(baseDir, requestedPath);
  const relative = path.relative(baseDir, resolved);
  const isEscaping = relative.startsWith("..") || path.isAbsolute(relative);
  isEscaping && (() => { throw new Error("Access denied: path escapes workspace root"); })();

  return resolved;
};

const parseInput = (input: unknown): DeleteFileInput => {
  const isObject = typeof input === "object" && input !== null && !Array.isArray(input);
  !isObject && (() => { throw new Error("Invalid delete_file input"); })();

  const data = input as Record<string, unknown>;
  const rawPath = typeof data.path === "string" ? data.path.trim() : "";
  !rawPath && (() => { throw new Error("File path is required"); })();

  return { path: rawPath };
};

export const createDeleteFileTool = (
  baseDir: string = process.cwd(),
): ToolDefinition<DeleteFileInput, DeleteFileOutput> => ({
  name: "delete_file",
  description: "Deletes a specified file from the workspace.",
  parameters,
  permissions: DEFAULT_PERMISSIONS,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  parseInput,
  execute: async ({ input }) => {
    const filePath = sanitizePath(baseDir, input.path);
    await fs.unlink(filePath);

    return {
      path: input.path,
      deleted: true,
      message: `Successfully deleted file '${input.path}'.`,
    };
  },
});
