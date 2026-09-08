import { exec } from "node:child_process";
import { promisify } from "node:util";

export const execAsync = promisify(exec);

/**
 * Execute a command with timeout and return stdout/stderr
 * @param cmd - Command to execute
 * @param cwd - Working directory
 * @param timeout - Timeout in milliseconds (default: 30s)
 */
export async function safeExec(
  cmd: string,
  cwd: string,
  timeout: number = 30_000,
): Promise<{ stdout: string; stderr: string }> {
  try {
    const result = await execAsync(cmd, { cwd, timeout });
    return { stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  } catch (err: unknown) {
    const error = err as { stdout?: string; stderr?: string; message?: string };
    return {
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? error.message ?? "Command execution failed",
    };
  }
}

/**
 * Validate branch name - only allows safe characters
 * @param name - Branch name to validate
 * @returns Sanitized branch name
 * @throws Error if branch name contains invalid characters
 */
export function validateBranchName(name: string): string {
  if (!name || typeof name !== "string") {
    throw new Error("Branch name is required");
  }
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new Error("Branch name cannot be empty");
  }
  if (trimmed.length > 255) {
    throw new Error("Branch name too long (max 255 characters)");
  }
  // Allow alphanumeric, dots, underscores, forward slashes, and hyphens
  // But reject: consecutive dots, leading/trailing dots, special git patterns
  const validPattern = /^[a-zA-Z0-9._/\-]+$/;
  if (!validPattern.test(trimmed)) {
    throw new Error(
      `Invalid branch name: "${trimmed}". Only alphanumeric characters, dots, underscores, forward slashes, and hyphens are allowed.`,
    );
  }
  // Reject names with consecutive dots
  if (trimmed.includes("..")) {
    throw new Error(`Invalid branch name: "${trimmed}". Cannot contain consecutive dots.`);
  }
  // Reject names starting or ending with dots
  if (trimmed.startsWith(".") || trimmed.endsWith(".")) {
    throw new Error(
      `Invalid branch name: "${trimmed}". Cannot start or end with a dot.`,
    );
  }
  // Reject names ending with .lock
  if (trimmed.endsWith(".lock")) {
    throw new Error(`Invalid branch name: "${trimmed}". Cannot end with ".lock".`);
  }
  // Reject names with @{, :, ^, [, ~, *
  const forbiddenPatterns = /[@\{\}:^\[~\*\?\x00-\x1f]/;
  if (forbiddenPatterns.test(trimmed)) {
    throw new Error(
      `Invalid branch name: "${trimmed}". Contains forbidden characters.`,
    );
  }
  return trimmed;
}

/**
 * Validate remote name - only allows safe characters
 * @param name - Remote name to validate
 * @returns Sanitized remote name
 * @throws Error if remote name contains invalid characters
 */
export function validateRemoteName(name: string): string {
  if (!name || typeof name !== "string") {
    throw new Error("Remote name is required");
  }
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new Error("Remote name cannot be empty");
  }
  if (trimmed.length > 100) {
    throw new Error("Remote name too long (max 100 characters)");
  }
  // Remote names: alphanumeric, dots, underscores, hyphens
  const validPattern = /^[a-zA-Z0-9._\-]+$/;
  if (!validPattern.test(trimmed)) {
    throw new Error(
      `Invalid remote name: "${trimmed}". Only alphanumeric characters, dots, underscores, and hyphens are allowed.`,
    );
  }
  // Reject names starting with dot or hyphen
  if (trimmed.startsWith(".") || trimmed.startsWith("-")) {
    throw new Error(
      `Invalid remote name: "${trimmed}". Cannot start with a dot or hyphen.`,
    );
  }
  return trimmed;
}

/**
 * Validate file path - rejects shell metacharacters
 * @param filePath - File path to validate
 * @returns Sanitized file path
 * @throws Error if file path contains shell metacharacters
 */
export function validateFilePath(filePath: string): string {
  if (!filePath || typeof filePath !== "string") {
    throw new Error("File path is required");
  }
  const trimmed = filePath.trim();
  if (trimmed.length === 0) {
    throw new Error("File path cannot be empty");
  }
  // Reject shell metacharacters
  const shellMetacharacters = /[|;&$`(){}\[\]!#~<>\\]/;
  if (shellMetacharacters.test(trimmed)) {
    throw new Error(
      `Invalid file path: "${trimmed}". Contains shell metacharacters.`,
    );
  }
  // Reject null bytes
  if (trimmed.includes("\0")) {
    throw new Error(`Invalid file path: "${trimmed}". Contains null bytes.`);
  }
  return trimmed;
}

/**
 * Escape a shell argument for safe use in commands
 * @param arg - Argument to escape
 * @returns Escaped argument wrapped in single quotes
 */
export function escapeShellArg(arg: string): string {
  if (arg === undefined || arg === null) {
    return "''";
  }
  const str = String(arg);
  // Wrap in single quotes and escape any single quotes inside
  return `'${str.replace(/'/g, "'\\''")}'`;
}
