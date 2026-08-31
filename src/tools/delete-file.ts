import fs from "node:fs/promises";
import path from "node:path";
import type {
  DeleteFileInput,
  DeleteFileOutput,
  ToolDefinition,
  ToolPermission,
} from "../types/tools.js";
import { resolveWorkspaceCandidate } from "./workspace-path.js";

const DEFAULT_PERMISSIONS: readonly ToolPermission[] = ["write"];
const DEFAULT_TIMEOUT_MS = 10_000;

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
    const targetPath = await resolveWorkspaceCandidate(baseDir, input.path, "delete");

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
      // If stat fails, attempt direct unlink
    }

    await fs.unlink(targetPath);

    // Optional: clean parent directory if custom empty dir
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
