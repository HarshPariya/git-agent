import fs from "node:fs/promises";
import path from "node:path";
import type {
  ReadFileInput,
  ReadFileOutput,
  ToolDefinition,
  ToolPermission,
} from "../types/tools.js";
import { resolveWorkspaceCandidate } from "./workspace-path.js";

const DEFAULT_PERMISSIONS: readonly ToolPermission[] = ["read"];
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_LINES_LIMIT = 500;
const MAX_FILE_BYTES = 50_000;

const parameters = {
  type: "object",
  properties: {
    path: {
      type: "string",
      description:
        "Relative path to the file to read (e.g. 'src/agent/orchestrator.ts' or 'planner.ts').",
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

const parseInput = (input: unknown): ReadFileInput => {
  const isObject =
    typeof input === "object" && input !== null && !Array.isArray(input);
  !isObject &&
    (() => {
      throw new Error("Invalid read_file input");
    })();

  const data = input as Record<string, unknown>;
  const rawPath = typeof data.path === "string" ? data.path.trim() : "";
  !rawPath &&
    (() => {
      throw new Error("File path is required");
    })();

  const rawStart =
    typeof data.startLine === "number"
      ? data.startLine
      : Number(data.startLine);
  const startLine = !isNaN(rawStart) && rawStart > 0 ? rawStart : undefined;

  const rawEnd =
    typeof data.endLine === "number" ? data.endLine : Number(data.endLine);
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
  description:
    "Reads the text contents of a file in the workspace. Supports optional line range slicing.",
  parameters,
  permissions: DEFAULT_PERMISSIONS,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  parseInput,
  execute: async ({ input }) => {
    const filePath = await resolveWorkspaceCandidate(baseDir, input.path, "read");
    const rawContent = await fs.readFile(filePath, "utf8");
    const boundedContent = rawContent.slice(0, MAX_FILE_BYTES);
    const lines = boundedContent.split("\n");
    const totalLines = lines.length;

    const start = Math.max(1, input.startLine ?? 1);
    const end = Math.min(
      totalLines,
      input.endLine ?? Math.min(totalLines, start + MAX_LINES_LIMIT - 1),
    );
    const selectedLines = lines.slice(start - 1, end);

    return {
      path: path.relative(baseDir, filePath).replace(/\\/g, "/"),
      totalLines,
      linesReturned: selectedLines.length,
      content: selectedLines.join("\n"),
    };
  },
});
