import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ToolDefinition, ToolPermission } from "../types/tools.js";

const execFileAsync = promisify(execFile);

const DEFAULT_PERMISSIONS: readonly ToolPermission[] = ["read", "write"];
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_CHARS = 4000;

export const SAFE_COMMAND_ALLOWLIST = new Set([
  "npm test",
  "npm run test",
  "npm run build",
  "npm run lint",
  "npm run typecheck",
  "npx tsc --noEmit",
  "pytest",
  "cargo test",
  "go test ./...",
]);

export interface CommandInput {
  command?: string;
}

export interface CommandOutput {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export const createRunTestTool = (
  baseDir: string = process.cwd(),
): ToolDefinition<CommandInput, CommandOutput> => ({
  name: "run_test",
  description: "Executes the test suite in the workspace using a controlled, safe test runner.",
  parameters: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "Test command to execute (e.g. 'npm test', 'npx tsc --noEmit', 'pytest')",
      },
    },
    required: [],
  },
  permissions: DEFAULT_PERMISSIONS,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  parseInput: (input: unknown) => {
    const raw = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
    return {
      command: typeof raw.command === "string" ? raw.command.trim() : "npm test",
    };
  },
  execute: async ({ input }) => {
    const cmd = input.command || "npm test";
    if (!SAFE_COMMAND_ALLOWLIST.has(cmd)) {
      throw new Error(
        `Command '${cmd}' is not permitted. Allowed commands: ${[...SAFE_COMMAND_ALLOWLIST].join(", ")}`,
      );
    }

    const startTime = Date.now();
    const [bin, ...args] = cmd.split(/\s+/);
    try {
      const { stdout, stderr } = await execFileAsync(bin!, args, {
        cwd: baseDir,
        timeout: DEFAULT_TIMEOUT_MS,
        maxBuffer: 1024 * 512,
      });

      return {
        command: cmd,
        exitCode: 0,
        stdout: stdout.slice(0, MAX_OUTPUT_CHARS),
        stderr: stderr.slice(0, MAX_OUTPUT_CHARS),
        durationMs: Date.now() - startTime,
      };
    } catch (err: unknown) {
      const execError = err as { code?: number; stdout?: string; stderr?: string; message?: string };
      return {
        command: cmd,
        exitCode: typeof execError.code === "number" ? execError.code : 1,
        stdout: (execError.stdout || "").slice(0, MAX_OUTPUT_CHARS),
        stderr: (execError.stderr || execError.message || "Command failed").slice(0, MAX_OUTPUT_CHARS),
        durationMs: Date.now() - startTime,
      };
    }
  },
});
