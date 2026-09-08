import { exec } from "node:child_process";
import { promisify } from "node:util";

export const execAsync = promisify(exec);

export type ExecResult = { readonly stdout: string; readonly stderr: string };

export async function safeExec(cmd: string, cwd: string, timeout = 30_000): Promise<ExecResult> {
  try {
    const result = await execAsync(cmd, { cwd, timeout, maxBuffer: 10 * 1024 * 1024 });
    return { stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? e.message ?? "Command execution failed" };
  }
}

export function validateBranchName(name: string): string {
  if (!name?.trim()) throw new Error("Branch name is required");

  const trimmed = name.trim();
  if (trimmed.length > 255) throw new Error("Branch name too long (max 255 characters)");
  if (!/^[a-zA-Z0-9._/\-]+$/.test(trimmed)) throw new Error(`Invalid branch name: "${trimmed}". Only alphanumeric, dots, underscores, slashes, and hyphens allowed.`);
  if (trimmed.includes("..")) throw new Error(`Invalid branch name: "${trimmed}". Cannot contain consecutive dots.`);
  if (trimmed.startsWith(".") || trimmed.endsWith(".")) throw new Error(`Invalid branch name: "${trimmed}". Cannot start or end with a dot.`);
  if (trimmed.endsWith(".lock")) throw new Error(`Invalid branch name: "${trimmed}". Cannot end with ".lock".`);
  if (/[@\{\}:^\[~\*\?\x00-\x1f]/.test(trimmed)) throw new Error(`Invalid branch name: "${trimmed}". Contains forbidden characters.`);

  return trimmed;
}

export function validateRemoteName(name: string): string {
  if (!name?.trim()) throw new Error("Remote name is required");

  const trimmed = name.trim();
  if (trimmed.length > 100) throw new Error("Remote name too long (max 100 characters)");
  if (!/^[a-zA-Z0-9._\-]+$/.test(trimmed)) throw new Error(`Invalid remote name: "${trimmed}". Only alphanumeric, dots, underscores, and hyphens allowed.`);
  if (trimmed.startsWith(".") || trimmed.startsWith("-")) throw new Error(`Invalid remote name: "${trimmed}". Cannot start with a dot or hyphen.`);

  return trimmed;
}

export function validateFilePath(filePath: string): string {
  if (!filePath?.trim()) throw new Error("File path is required");

  const trimmed = filePath.trim();
  if (/[|;&$`(){}\[\]!#~<>\\]/.test(trimmed)) throw new Error(`Invalid file path: "${trimmed}". Contains shell metacharacters.`);
  if (trimmed.includes("\0")) throw new Error(`Invalid file path: "${trimmed}". Contains null bytes.`);

  return trimmed;
}

export function escapeShellArg(arg: string): string {
  return `'${String(arg ?? "").replace(/'/g, "'\\''")}'`;
}
