import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  GitStatusInput,
  GitStatusOutput,
  ToolDefinition,
  ToolPermission,
} from "../types/tools.js";

const execFileAsync = promisify(execFile);

const DEFAULT_PERMISSIONS: readonly ToolPermission[] = ["read"];
const DEFAULT_TIMEOUT_MS = 8_000;

type GitAction = "status" | "branch" | "log";

const ACTION_COMMANDS: Readonly<Record<GitAction, readonly string[]>> = {
  status: ["status", "--short"],
  branch: ["branch", "--show-current"],
  log: ["log", "-n", "5", "--oneline"],
};

const parameters = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["status", "branch", "log"],
      description: "Git inspection action to perform. Defaults to 'status'.",
    },
  },
  additionalProperties: false,
} as const;

const parseInput = (input: unknown): GitStatusInput => {
  const data = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const rawAction = typeof data.action === "string" ? data.action.toLowerCase().trim() : "status";
  const validAction: GitAction =
    rawAction === "branch" || rawAction === "log" ? rawAction : "status";

  return { action: validAction };
};

export const createGitStatusTool = (
  baseDir: string = process.cwd(),
): ToolDefinition<GitStatusInput, GitStatusOutput> => ({
  name: "git_status",
  description: "Inspects git repository status, active branch, or recent commits in the project workspace.",
  parameters,
  permissions: DEFAULT_PERMISSIONS,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  parseInput,
  execute: async ({ input }) => {
    const action: GitAction = input.action ?? "status";
    const args: readonly string[] = ACTION_COMMANDS[action] ?? ACTION_COMMANDS.status;

    try {
      const { stdout } = await execFileAsync("git", [...args], {
        cwd: baseDir,
        timeout: DEFAULT_TIMEOUT_MS,
      });

      return {
        action,
        output: stdout.trim() || "Git repository is clean / working tree clean",
      };
    } catch (error) {
      return {
        action,
        output: `Git command error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
});
