import fs from "node:fs/promises";
import path from "node:path";
import type {
  EditFileInput,
  EditFileOutput,
  ToolDefinition,
  ToolPermission,
} from "../types/tools.js";

const DEFAULT_PERMISSIONS: readonly ToolPermission[] = ["write"];
const DEFAULT_TIMEOUT_MS = 10_000;
const PROTECTED_FILES = new Set([".env", "package.json", "package-lock.json"]);

const parameters = {
  type: "object",
  properties: {
    path: {
      type: "string",
      description: "Relative file path to modify (e.g. 'src/agent/custom.ts').",
    },
    targetContent: {
      type: "string",
      description: "The exact substring to find and replace in the file (also accepts old_text or target).",
    },
    replacementContent: {
      type: "string",
      description: "The new content to replace the target substring with (also accepts new_text or replacement).",
    },
  },
  required: ["path", "targetContent", "replacementContent"],
  additionalProperties: false,
} as const;

const sanitizePath = (baseDir: string, requestedPath: string): string => {
  const containsNull = requestedPath.includes("\0");
  containsNull && (() => { throw new Error("Path contains illegal null bytes"); })();

  const filename = path.basename(requestedPath);
  const isProtected = PROTECTED_FILES.has(filename) || filename.startsWith(".env");
  isProtected && (() => { throw new Error("Access denied: modifying protected system file is disallowed"); })();

  const resolved = path.resolve(baseDir, requestedPath);
  const relative = path.relative(baseDir, resolved);
  const isEscaping = relative.startsWith("..") || path.isAbsolute(relative);
  isEscaping && (() => { throw new Error("Access denied: path escapes workspace root"); })();

  return resolved;
};

const extractString = (data: Record<string, unknown>, keys: readonly string[]): string => {
  for (const key of keys) {
    if (typeof data[key] === "string" && data[key].length > 0) {
      return data[key] as string;
    }
  }
  return "";
};

const parseInput = (input: unknown): EditFileInput => {
  const isObject = typeof input === "object" && input !== null && !Array.isArray(input);
  !isObject && (() => { throw new Error("Invalid edit_file input"); })();

  const data = input as Record<string, unknown>;
  const rawPath = extractString(data, ["path", "filePath", "file_path", "filename", "file"]);
  !rawPath && (() => { throw new Error("File path is required"); })();

  const targetContent = extractString(data, [
    "targetContent",
    "old_text",
    "oldText",
    "target",
    "target_text",
    "find",
    "old_content",
    "oldContent",
    "from",
  ]);
  !targetContent && (() => { throw new Error("targetContent is required"); })();

  const replacementContent = extractString(data, [
    "replacementContent",
    "new_text",
    "newText",
    "replacement",
    "replacement_text",
    "replace",
    "new_content",
    "newContent",
    "to",
  ]);

  return { path: rawPath, targetContent, replacementContent };
};

export const createEditFileTool = (
  baseDir: string = process.cwd(),
): ToolDefinition<EditFileInput, EditFileOutput> => ({
  name: "edit_file",
  description: "Modifies a file in the workspace by replacing targetContent (or old_text) with replacementContent (or new_text).",
  parameters,
  permissions: DEFAULT_PERMISSIONS,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  parseInput,
  execute: async ({ input }) => {
    const filePath = sanitizePath(baseDir, input.path);
    const existingContent = await fs.readFile(filePath, "utf8");

    const containsTarget = existingContent.includes(input.targetContent);
    !containsTarget && (() => {
      throw new Error(`Target content not found in file '${input.path}'`);
    })();

    const updatedContent = existingContent.replace(input.targetContent, input.replacementContent);
    await fs.writeFile(filePath, updatedContent, "utf8");

    return {
      path: input.path,
      modified: true,
      message: `Successfully updated '${input.path}'.`,
    };
  },
});
