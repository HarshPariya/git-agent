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

const PROTECTED_DIRS = new Set([
  "",
  ".",
  "src",
  "public",
  "node_modules",
  ".git",
]);

const parameters = {
  type: "object",
  properties: {
    path: {
      type: "string",
      description:
        "Relative path of the file or folder to delete (e.g. 'src/agent/temp.ts' or 'temp_folder').",
    },
  },
  required: ["path"],
} as const;

const sanitizePath = (baseDir: string, requestedPath: string): string => {
  const containsNull = requestedPath.includes("\0");
  containsNull &&
    (() => {
      throw new Error("Path contains illegal null bytes");
    })();

  const filename = path.basename(requestedPath);
  const isProtected =
    PROTECTED_FILES.has(filename) || filename.startsWith(".env");
  isProtected &&
    (() => {
      throw new Error(
        "Access denied: deleting protected project file is prohibited",
      );
    })();

  const resolved = path.resolve(baseDir, requestedPath);
  const relative = path.relative(baseDir, resolved);
  const isEscaping = relative.startsWith("..") || path.isAbsolute(relative);
  isEscaping &&
    (() => {
      throw new Error("Access denied: path escapes workspace root");
    })();

  const isProtectedDir = PROTECTED_DIRS.has(relative.replace(/\\/g, "/"));
  isProtectedDir &&
    (() => {
      throw new Error(
        "Access denied: deleting root system directory is prohibited",
      );
    })();

  return resolved;
};

const extractString = (
  data: Record<string, unknown>,
  keys: readonly string[],
): string => {
  for (const key of keys) {
    if (typeof data[key] === "string" && (data[key] as string).trim().length > 0) {
      return (data[key] as string).trim();
    }
  }
  return "";
};

const parseInput = (input: unknown): DeleteFileInput => {
  const isObject =
    typeof input === "object" && input !== null && !Array.isArray(input);
  !isObject &&
    (() => {
      throw new Error("Invalid delete_file input");
    })();

  const data = input as Record<string, unknown>;
  const rawPath = extractString(data, [
    "path",
    "filePath",
    "file_path",
    "target",
    "folder",
    "directory",
    "filename",
    "file",
  ]);
  !rawPath &&
    (() => {
      throw new Error("File or folder path is required");
    })();

  return { path: rawPath };
};

export const createDeleteFileTool = (
  baseDir: string = process.cwd(),
): ToolDefinition<DeleteFileInput, DeleteFileOutput> => ({
  name: "delete_file",
  description: "Deletes a specified file or directory from the workspace.",
  parameters,
  permissions: DEFAULT_PERMISSIONS,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  parseInput,
  execute: async ({ input }) => {
    let targetPath = sanitizePath(baseDir, input.path);

    // If requested path without directory exists in docs/, resolve to docs/
    if (!input.path.includes("/") && !input.path.includes("\\")) {
      const docsCandidate = path.resolve(baseDir, "docs", input.path);
      try {
        await fs.access(docsCandidate);
        targetPath = docsCandidate;
      } catch {
        // Fall back to direct targetPath
      }
    }

    try {
      const stat = await fs.stat(targetPath);
      if (stat.isDirectory()) {
        await fs.rm(targetPath, { recursive: true, force: true });
        return {
          path: input.path,
          deleted: true,
          message: `Successfully deleted directory '${input.path}'.`,
        };
      }
    } catch {
      // If stat fails, attempt direct unlink/rm
    }

    await fs.unlink(targetPath);

    // Optional: if parent dir is a custom empty dir (e.g. harsh), clean it up
    const parentDir = path.dirname(targetPath);
    const parentRel = path.relative(baseDir, parentDir).replace(/\\/g, "/");
    const preservedDirs = new Set(["", "src", "docs", "public", "tests", "migrations", "dist", "dist-member2", "node_modules", ".git"]);
    if (!preservedDirs.has(parentRel)) {
      try {
        const entries = await fs.readdir(parentDir);
        if (entries.length === 0) {
          await fs.rm(parentDir, { recursive: true, force: true });
        }
      } catch {
        // Ignore parent cleanup errors
      }
    }

    return {
      path: input.path,
      deleted: true,
      message: `Successfully deleted '${input.path}'.`,
    };
  },
});
