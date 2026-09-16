import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { assertWithinRoot, validateSafeRepoPath } from "./security.js";
import type {
  LocalGitBranch,
  LocalGitCommit,
  LocalGitStatus,
  LocalGitStatusEntry,
  ValidateRepoResponse,
} from "./types.js";

const execFileAsync = promisify(execFile);

export async function runGit(
  args: string[],
  cwd: string,
  timeoutMs = 30000,
): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execFileAsync("git", args, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8" },
    });
  } catch (err: unknown) {
    const errorObj = err as { stdout?: string; stderr?: string; message?: string; code?: number };
    const errMessage = errorObj.stderr?.trim() || errorObj.stdout?.trim() || errorObj.message || "Git command failed";
    const error = new Error(errMessage, { cause: err });
    type DecoratedError = { code?: number | undefined; stdout?: string | undefined; stderr?: string | undefined };
    (error as unknown as DecoratedError).code = errorObj.code;
    (error as unknown as DecoratedError).stdout = errorObj.stdout;
    (error as unknown as DecoratedError).stderr = errorObj.stderr;
    throw error;
  }
}

export async function checkGitInstalled(): Promise<{ installed: boolean; version?: string }> {
  try {
    const { stdout } = await execFileAsync("git", ["--version"]);
    return { installed: true, version: stdout.trim().replace(/^git version\s*/i, "") };
  } catch {
    return { installed: false };
  }
}

export async function validateRepo(rawPath: string): Promise<ValidateRepoResponse> {
  const repoPath = validateSafeRepoPath(rawPath);
  const gitDir = path.join(repoPath, ".git");

  try {
    const stat = await fs.stat(gitDir);
    if (!stat.isDirectory() && !stat.isFile()) {
      return { isGit: false, path: repoPath, name: path.basename(repoPath), branch: "", remoteUrl: "" };
    }
  } catch {
    return { isGit: false, path: repoPath, name: path.basename(repoPath), branch: "", remoteUrl: "" };
  }

  let branch = "main";
  try {
    const { stdout } = await runGit(["rev-parse", "--abbrev-ref", "HEAD"], repoPath);
    branch = stdout.trim() || "main";
  } catch {
    // Empty repo without commits
  }

  let remoteUrl = "";
  try {
    const { stdout } = await runGit(["remote", "get-url", "origin"], repoPath);
    remoteUrl = stdout.trim();
  } catch {
    // No remote origin
  }

  return {
    isGit: true,
    path: repoPath,
    name: path.basename(repoPath),
    branch,
    remoteUrl,
  };
}

export async function getStatus(rawPath: string): Promise<LocalGitStatus> {
  const repoPath = validateSafeRepoPath(rawPath);
  const { stdout: porcelain } = await runGit(["status", "--porcelain=v1", "-uall"], repoPath);

  let branch = "main";
  let ahead = 0;
  let behind = 0;

  try {
    const { stdout: branchOut } = await runGit(["status", "--branch", "--porcelain=v1"], repoPath);
    const firstLine = branchOut.split("\n")[0] || "";
    const branchMatch = /^## ([^. \t]+)/.exec(firstLine);
    if (branchMatch?.[1]) {
      branch = branchMatch[1];
    }
    const aheadMatch = /ahead (\d+)/.exec(firstLine);
    if (aheadMatch?.[1]) {
      ahead = parseInt(aheadMatch[1], 10);
    }
    const behindMatch = /behind (\d+)/.exec(firstLine);
    if (behindMatch?.[1]) {
      behind = parseInt(behindMatch[1], 10);
    }
  } catch {
    // Fallback if detached or new
  }

  const entries: LocalGitStatusEntry[] = [];
  const lines = porcelain.split("\n").filter(Boolean);

  for (const line of lines) {
    if (line.length < 3) continue;
    const indexCode = line.charAt(0);
    const workCode = line.charAt(1);
    const rawFilePath = line.substring(3).trim().replace(/^"|"$/g, "");

    let status: LocalGitStatusEntry["status"] = "modified";
    if (indexCode === "?" || workCode === "?") {
      status = "untracked";
    } else if (indexCode === "A" || workCode === "A") {
      status = "added";
    } else if (indexCode === "D" || workCode === "D") {
      status = "deleted";
    } else if (indexCode === "R" || workCode === "R") {
      status = "renamed";
    }

    const staged = indexCode !== " " && indexCode !== "?";

    entries.push({
      filePath: rawFilePath.replace(/\\/g, "/"),
      status,
      staged,
      workingTreeStatus: workCode,
      indexStatus: indexCode,
    });
  }

  return {
    branch,
    clean: entries.length === 0,
    ahead,
    behind,
    entries,
  };
}

export async function getDiff(rawPath: string, filePath?: string, staged = false): Promise<{ diff: string }> {
  const repoPath = validateSafeRepoPath(rawPath);
  const args = ["diff"];
  if (staged) args.push("--staged");

  if (filePath && filePath.trim()) {
    const normalizedFile = path.normalize(filePath.trim()).replace(/^(\.\/|\.\\)/, "");
    args.push("--", normalizedFile);
  }

  const { stdout } = await runGit(args, repoPath);
  return { diff: stdout };
}

export async function stage(rawPath: string, files: string[]): Promise<{ success: boolean; stagedCount: number }> {
  const repoPath = validateSafeRepoPath(rawPath);

  if (!files || files.length === 0) {
    await runGit(["add", "-A"], repoPath);
    return { success: true, stagedCount: -1 };
  }

  const safeFiles = files.map((f) => path.normalize(f.trim()).replace(/^(\.\/|\.\\)/, ""));
  await runGit(["add", "--", ...safeFiles], repoPath);
  return { success: true, stagedCount: safeFiles.length };
}

export async function unstage(rawPath: string, files: string[]): Promise<{ success: boolean; unstagedCount: number }> {
  const repoPath = validateSafeRepoPath(rawPath);

  if (!files || files.length === 0) {
    await runGit(["restore", "--staged", "."], repoPath);
    return { success: true, unstagedCount: -1 };
  }

  const safeFiles = files.map((f) => path.normalize(f.trim()).replace(/^(\.\/|\.\\)/, ""));
  await runGit(["restore", "--staged", "--", ...safeFiles], repoPath);
  return { success: true, unstagedCount: safeFiles.length };
}

export async function commit(
  rawPath: string,
  message: string,
): Promise<{ success: boolean; commitHash: string; message: string }> {
  const repoPath = validateSafeRepoPath(rawPath);
  if (!message || !message.trim()) {
    throw new Error("Commit message cannot be empty");
  }

  await runGit(["commit", "-m", message.trim()], repoPath);
  const { stdout: hashOut } = await runGit(["rev-parse", "HEAD"], repoPath);

  return {
    success: true,
    commitHash: hashOut.trim(),
    message: message.trim(),
  };
}

export async function listBranches(rawPath: string): Promise<LocalGitBranch[]> {
  const repoPath = validateSafeRepoPath(rawPath);
  const { stdout } = await runGit(["branch", "-a", "--format=%(HEAD)|%(refname:short)"], repoPath);

  const branches: LocalGitBranch[] = [];
  const lines = stdout.split("\n").filter(Boolean);

  for (const line of lines) {
    const [headMark, name] = line.split("|");
    if (!name || name.includes("HEAD")) continue;

    const isCurrent = headMark?.trim() === "*";
    const isRemote = name.startsWith("origin/") || name.startsWith("remotes/");
    const cleanName = isRemote ? name.replace(/^(origin\/|remotes\/origin\/)/, "") : name;

    const branchObj: LocalGitBranch = {
      name: cleanName,
      current: isCurrent,
    };
    if (isRemote) {
      branchObj.remote = "origin";
    }
    branches.push(branchObj);
  }

  return branches;
}

export async function checkoutBranch(rawPath: string, branch: string): Promise<{ success: boolean; branch: string }> {
  const repoPath = validateSafeRepoPath(rawPath);
  if (!branch || !branch.trim()) throw new Error("Branch name required");

  await runGit(["checkout", branch.trim()], repoPath);
  return { success: true, branch: branch.trim() };
}

export async function createBranch(rawPath: string, branch: string): Promise<{ success: boolean; branch: string }> {
  const repoPath = validateSafeRepoPath(rawPath);
  if (!branch || !branch.trim()) throw new Error("Branch name required");

  await runGit(["checkout", "-b", branch.trim()], repoPath);
  return { success: true, branch: branch.trim() };
}

export async function deleteBranch(
  rawPath: string,
  branch: string,
  force = false,
): Promise<{ success: boolean; branch: string }> {
  const repoPath = validateSafeRepoPath(rawPath);
  if (!branch || !branch.trim()) throw new Error("Branch name required");

  const flag = force ? "-D" : "-d";
  await runGit(["branch", flag, branch.trim()], repoPath);
  return { success: true, branch: branch.trim() };
}

export async function syncFetch(rawPath: string, remote = "origin"): Promise<{ success: boolean; output: string }> {
  const repoPath = validateSafeRepoPath(rawPath);
  const { stdout, stderr } = await runGit(["fetch", remote], repoPath, 60000);
  return { success: true, output: (stdout + "\n" + stderr).trim() };
}

export async function syncPull(
  rawPath: string,
  remote = "origin",
  branch?: string,
): Promise<{ success: boolean; output: string; conflict: boolean }> {
  const repoPath = validateSafeRepoPath(rawPath);
  const args = ["pull", remote];
  if (branch && branch.trim()) args.push(branch.trim());

  try {
    const { stdout, stderr } = await runGit(args, repoPath, 60000);
    return { success: true, output: (stdout + "\n" + stderr).trim(), conflict: false };
  } catch (err: unknown) {
    const msg = String(err);
    const isConflict = msg.toLowerCase().includes("conflict");
    return { success: false, output: msg, conflict: isConflict };
  }
}

export async function syncPush(
  rawPath: string,
  remote = "origin",
  branch?: string,
  setUpstream = false,
): Promise<{ success: boolean; output: string }> {
  const repoPath = validateSafeRepoPath(rawPath);
  const args = ["push"];
  if (setUpstream) args.push("-u");
  args.push(remote);
  if (branch && branch.trim()) args.push(branch.trim());

  const { stdout, stderr } = await runGit(args, repoPath, 60000);
  return { success: true, output: (stdout + "\n" + stderr).trim() };
}

export async function stashPush(rawPath: string, message?: string): Promise<{ success: boolean; message: string }> {
  const repoPath = validateSafeRepoPath(rawPath);
  const args = ["stash", "push"];
  if (message && message.trim()) {
    args.push("-m", message.trim());
  }

  const { stdout } = await runGit(args, repoPath);
  return { success: true, message: stdout.trim() };
}

export async function stashList(rawPath: string): Promise<Array<{ index: number; description: string }>> {
  const repoPath = validateSafeRepoPath(rawPath);
  const { stdout } = await runGit(["stash", "list"], repoPath);
  return stdout
    .split("\n")
    .filter(Boolean)
    .map((line, i) => ({ index: i, description: line.trim() }));
}

export async function stashPop(rawPath: string, index = 0): Promise<{ success: boolean; output: string }> {
  const repoPath = validateSafeRepoPath(rawPath);
  const { stdout, stderr } = await runGit(["stash", "pop", `stash@{${index}}`], repoPath);
  return { success: true, output: (stdout + "\n" + stderr).trim() };
}

export async function stashApply(rawPath: string, index = 0): Promise<{ success: boolean; output: string }> {
  const repoPath = validateSafeRepoPath(rawPath);
  const { stdout, stderr } = await runGit(["stash", "apply", `stash@{${index}}`], repoPath);
  return { success: true, output: (stdout + "\n" + stderr).trim() };
}

export async function stashDrop(rawPath: string, index = 0): Promise<{ success: boolean; output: string }> {
  const repoPath = validateSafeRepoPath(rawPath);
  const { stdout, stderr } = await runGit(["stash", "drop", `stash@{${index}}`], repoPath);
  return { success: true, output: (stdout + "\n" + stderr).trim() };
}

export async function getConflicts(rawPath: string): Promise<string[]> {
  const repoPath = validateSafeRepoPath(rawPath);
  const { stdout } = await runGit(["diff", "--name-only", "--diff-filter=U"], repoPath);
  return stdout
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function resolveConflict(
  rawPath: string,
  filePath: string,
  resolvedContent: string,
): Promise<{ success: boolean; filePath: string }> {
  const repoPath = validateSafeRepoPath(rawPath);
  const fullPath = assertWithinRoot(path.join(repoPath, filePath), repoPath);

  await fs.writeFile(fullPath, resolvedContent, "utf-8");
  await runGit(["add", "--", path.relative(repoPath, fullPath)], repoPath);

  return { success: true, filePath };
}

export async function discard(rawPath: string, filePath?: string): Promise<{ success: boolean }> {
  const repoPath = validateSafeRepoPath(rawPath);

  if (filePath && filePath.trim()) {
    const fullPath = assertWithinRoot(path.join(repoPath, filePath.trim()), repoPath);
    try {
      await runGit(["restore", "--staged", "--worktree", "--", path.relative(repoPath, fullPath)], repoPath);
    } catch {
      // If untracked, remove file
      await fs.unlink(fullPath).catch(() => {});
    }
  } else {
    // Discard all tracked modifications
    await runGit(["restore", "--staged", "--worktree", "."], repoPath).catch(() => {});
  }

  return { success: true };
}

export async function getLog(rawPath: string, limit = 40): Promise<LocalGitCommit[]> {
  const repoPath = validateSafeRepoPath(rawPath);
  const format = "%H|%h|%s|%an|%ae|%ad|%cr";
  const { stdout } = await runGit(["log", `-${limit}`, `--format=${format}`], repoPath);

  const commits: LocalGitCommit[] = [];
  for (const line of stdout.split("\n").filter(Boolean)) {
    const [hash, shortHash, subject, authorName, authorEmail, authorDate, relativeDate] = line.split("|");
    if (hash && shortHash) {
      commits.push({
        hash,
        shortHash,
        subject: subject || "Commit",
        authorName: authorName || "Author",
        authorEmail: authorEmail || "",
        authorDate: authorDate || "",
        relativeDate: relativeDate || "",
      });
    }
  }

  return commits;
}
