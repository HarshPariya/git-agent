import fs from "node:fs/promises";
import type {
  EditFileInput,
  EditFileOutput,
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
        "Relative path of the file to edit (e.g. 'src/agent/orchestrator.ts' or 'planner.ts').",
    },
    targetContent: {
      type: "string",
      description: "Exact text content within the file to be replaced.",
    },
    replacementContent: {
      type: "string",
      description: "New text content to replace targetContent with.",
    },
  },
  required: ["path"],
} as const;

const extractString = (
  data: Record<string, unknown>,
  keys: readonly string[],
): string => {
  for (const key of keys) {
    if (
      typeof data[key] === "string" &&
      (data[key] as string).length > 0
    ) {
      return data[key] as string;
    }
  }
  return "";
};

const parseInput = (input: unknown): EditFileInput => {
  const isObject =
    typeof input === "object" && input !== null && !Array.isArray(input);
  !isObject &&
    (() => {
      throw new Error("Invalid edit_file input");
    })();

  const data = input as Record<string, unknown>;
  const rawPath = extractString(data, [
    "path",
    "filePath",
    "file_path",
    "filename",
    "file",
  ]).trim();
  !rawPath &&
    (() => {
      throw new Error("File path is required");
    })();

  const targetContent = extractString(data, [
    "targetContent",
    "oldContent",
    "old_content",
    "old_text",
    "oldText",
    "target",
    "target_text",
    "search",
    "find",
    "from",
  ]);
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
  description:
    "Modifies a file in the workspace by replacing targetContent (or old_text) with replacementContent (or new_text).",
  parameters,
  permissions: DEFAULT_PERMISSIONS,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  parseInput,
  execute: async ({ input }) => {
    const filePath = await resolveWorkspaceCandidate(baseDir, input.path, "write");
    const existingContent = await fs.readFile(filePath, "utf8");

    const containsTarget = existingContent.includes(input.targetContent);
    !containsTarget &&
      (() => {
        throw new Error(`Target content not found in file '${input.path}'`);
      })();

    const updatedContent = existingContent.replace(
      input.targetContent,
      input.replacementContent,
    );
    await fs.writeFile(filePath, updatedContent, "utf8");

    return {
      path: input.path,
      modified: true,
      message: `Successfully edited '${input.path}'.`,
    };
  },
});
