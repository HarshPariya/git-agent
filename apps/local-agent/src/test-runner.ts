import { exec } from "node:child_process";
import { validateSafeRepoPath } from "./security.js";
import type { TestRunResult } from "./types.js";

const ALLOWED_TEST_COMMAND_PREFIXES = [
  "npm test",
  "pnpm test",
  "yarn test",
  "npx vitest",
  "npx jest",
  "pytest",
  "cargo test",
  "go test",
  "node",
];

export async function runLocalTests(
  rawRepoPath: string,
  command = "npm test",
  timeoutMs = 120000,
): Promise<TestRunResult> {
  const repoPath = validateSafeRepoPath(rawRepoPath);
  const trimmed = command.trim();

  const isAllowed = ALLOWED_TEST_COMMAND_PREFIXES.some(
    (prefix) => trimmed === prefix || trimmed.startsWith(`${prefix} `),
  );

  if (!isAllowed) {
    throw new Error(
      `Command '${command}' is not in the allowed test runner allowlist (${ALLOWED_TEST_COMMAND_PREFIXES.join(", ")})`,
    );
  }

  const startTime = Date.now();

  return new Promise<TestRunResult>((resolve) => {
    const proc = exec(trimmed, {
      cwd: repoPath,
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, CI: "true" },
    });

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += String(chunk);
    });

    proc.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += String(chunk);
    });

    proc.on("close", (code) => {
      const durationMs = Date.now() - startTime;
      resolve({
        command: trimmed,
        success: code === 0,
        exitCode: code ?? 1,
        durationMs,
        stdout,
        stderr,
      });
    });

    proc.on("error", (err) => {
      const durationMs = Date.now() - startTime;
      resolve({
        command: trimmed,
        success: false,
        exitCode: 1,
        durationMs,
        stdout,
        stderr: err.message,
      });
    });
  });
}
