import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { AppError } from "../errors/app-error.js";
import type {
  GitOperation,
  GitOperationType,
  GitOperationRisk,
  GitStatusOutput,
  GitStatusEntry,
  GitLogEntry,
  GitDiffEntry,
  GitBranch,
  GitStashEntry,
  GitGraphNode,
} from "../types/git.js";
import { execFileAsync } from "./utils.js";

export type { GitOperationType };

const repositoryPaths = new Map<string, string>();

export function registerRepositoryPath(repositoryId: string, localPath: string): void {
  repositoryPaths.set(repositoryId, localPath);
}

export function getExecutionPath(repositoryOrPath: string): string {
  if (!repositoryOrPath || !repositoryOrPath.trim()) {
    throw new AppError("Repository context is required for Git operations", "REPOSITORY_REQUIRED", 400);
  }
  const mapped = repositoryPaths.get(repositoryOrPath);
  if (mapped && fs.existsSync(mapped)) return mapped;
  if (fs.existsSync(repositoryOrPath)) return path.resolve(repositoryOrPath);
  throw new AppError(
    `Repository workspace for "${repositoryOrPath}" not found or inaccessible`,
    "REPOSITORY_REQUIRED",
    400,
  );
}

const GIT_OPERATION_CATALOG: readonly GitOperation[] = [
  {
    type: "status",
    risk: "safe",
    command: "git status --porcelain -b",
    description: "Show working tree status",
    requiresApproval: false,
    dryRunSupported: true,
  },
  {
    type: "log",
    risk: "safe",
    command: "git log",
    description: "Show commit history",
    requiresApproval: false,
    dryRunSupported: true,
  },
  {
    type: "diff",
    risk: "safe",
    command: "git diff",
    description: "Show changes between commits",
    requiresApproval: false,
    dryRunSupported: true,
  },
  {
    type: "branch",
    risk: "safe",
    command: "git branch -a",
    description: "List branches",
    requiresApproval: false,
    dryRunSupported: true,
  },
  {
    type: "checkout",
    risk: "controlled",
    command: "git checkout",
    description: "Switch branches",
    requiresApproval: true,
    dryRunSupported: true,
  },
  {
    type: "commit",
    risk: "controlled",
    command: "git commit",
    description: "Record changes",
    requiresApproval: true,
    dryRunSupported: true,
  },
  {
    type: "push",
    risk: "dangerous",
    command: "git push",
    description: "Upload refs",
    requiresApproval: true,
    dryRunSupported: true,
  },
  {
    type: "pull",
    risk: "dangerous",
    command: "git pull",
    description: "Fetch and merge",
    requiresApproval: true,
    dryRunSupported: true,
  },
  {
    type: "merge",
    risk: "dangerous",
    command: "git merge",
    description: "Join histories",
    requiresApproval: true,
    dryRunSupported: true,
  },
  {
    type: "reset",
    risk: "dangerous",
    command: "git reset",
    description: "Reset current HEAD",
    requiresApproval: true,
    dryRunSupported: true,
  },
  {
    type: "revert",
    risk: "controlled",
    command: "git revert",
    description: "Revert commits",
    requiresApproval: true,
    dryRunSupported: true,
  },
  {
    type: "tag",
    risk: "controlled",
    command: "git tag",
    description: "Create tags",
    requiresApproval: true,
    dryRunSupported: true,
  },
  {
    type: "stash",
    risk: "controlled",
    command: "git stash",
    description: "Stash changes",
    requiresApproval: false,
    dryRunSupported: true,
  },
  {
    type: "cherry-pick",
    risk: "dangerous",
    command: "git cherry-pick",
    description: "Apply commits",
    requiresApproval: true,
    dryRunSupported: true,
  },
  {
    type: "amend",
    risk: "dangerous",
    command: "git commit --amend",
    description: "Amend last commit",
    requiresApproval: true,
    dryRunSupported: true,
  },
  {
    type: "fetch",
    risk: "safe",
    command: "git fetch",
    description: "Download objects",
    requiresApproval: false,
    dryRunSupported: true,
  },
  {
    type: "clone",
    risk: "safe",
    command: "git clone",
    description: "Clone repository",
    requiresApproval: false,
    dryRunSupported: true,
  },
  {
    type: "init",
    risk: "safe",
    command: "git init",
    description: "Initialize repo",
    requiresApproval: false,
    dryRunSupported: true,
  },
];

const PROTECTED_BRANCH_PATTERNS = ["main", "master", "production", "release", "develop", "staging"];

const STATUS_CHAR_MAP: Record<string, GitStatusEntry["status"]> = {
  "??": "untracked",
  "!!": "ignored",
  A: "added",
  M: "modified",
  D: "deleted",
  R: "renamed",
  C: "copied",
};

export const parseStatusChar = (code: string): GitStatusEntry["status"] => STATUS_CHAR_MAP[code] ?? "modified";

const RISK_LABELS: Record<GitOperationRisk, string> = {
  safe: "read-only",
  controlled: "requires-approval",
  dangerous: "requires-review",
};

export function classifyOperation(type: GitOperationType): GitOperation {
  const op = GIT_OPERATION_CATALOG.find((o) => o.type === type);
  if (!op) throw new AppError(`Unknown git operation: ${type}`, "VALIDATION_ERROR", 400);
  return op;
}

export function isProtectedBranch(branch: string): boolean {
  const normalized = branch
    .replace(/^origin\//, "")
    .replace(/\*/g, "")
    .trim();
  return PROTECTED_BRANCH_PATTERNS.some((p) => normalized === p);
}

export function getProtectedBranchNames(): readonly string[] {
  return PROTECTED_BRANCH_PATTERNS;
}

export async function executeGitStatus(repoPath: string): Promise<GitStatusOutput> {
  const execPath = getExecutionPath(repoPath);
  await runGit(execPath, ["update-index", "-q", "--refresh"]).catch(() => "");
  const output = await runGit(execPath, ["status", "--porcelain=v1", "-b", "-u"]);
  const lines = output.replace(/\r/g, "").trim().split("\n").filter(Boolean);
  const branchLine = lines[0] ?? "";
  const branchMatch = branchLine.match(/^## (?:(.+?)(?:\.\.\.(.+?))?(?:\s*\[(.+?)\])?)$/);

  let branch = "unknown";
  let ahead = 0;
  let behind = 0;
  let detached = false;

  async function resolveDetachedBranch(execPath: string): Promise<string> {
    try {
      const nameRev = await runGit(execPath, ["name-rev", "--name-only", "HEAD"]).catch(() => "");
      const cleanName = nameRev
        .trim()
        .replace(/^remotes\/origin\//, "")
        .replace(/^origin\//, "")
        .replace(/[~^].*$/, "");
      if (cleanName && cleanName !== "undefined" && cleanName !== "HEAD") {
        return cleanName;
      }
    } catch {
      // Ignore
    }

    try {
      const containsOutput = await runGit(execPath, ["branch", "-a", "--contains", "HEAD"]).catch(() => "");
      const candidateLines = containsOutput
        .split("\n")
        .map((l) => l.trim().replace(/^\*\s*/, ""))
        .filter(Boolean);

      for (const candidate of candidateLines) {
        const b = candidate
          .replace(/^remotes\/origin\//, "")
          .replace(/^origin\//, "")
          .trim();
        if (b && !b.includes("HEAD") && !b.includes("detached") && !b.includes("no branch")) {
          return b;
        }
      }
    } catch {
      // Ignore
    }

    return process.env.GIT_DEFAULT_BRANCH || "main";
  }

  if (branchMatch) {
    let branchName = branchMatch[1] ?? "unknown";
    branchName = branchName.replace("No commits yet on ", "").replace("Initial commit on ", "").trim();
    detached = branchName.includes("no branch") || branchName.includes("HEAD (no branch)");
    branch = detached ? "unknown" : branchName;

    const trackingInfo = branchMatch[3];
    const aheadMatch = trackingInfo?.match(/ahead\s+(\d+)/);
    const behindMatch = trackingInfo?.match(/behind\s+(\d+)/);
    ahead = aheadMatch ? parseInt(aheadMatch[1] ?? "0", 10) : 0;
    behind = behindMatch ? parseInt(behindMatch[1] ?? "0", 10) : 0;
  }

  if (branch === "unknown" || branch === "detached" || detached) {
    try {
      const branchOutput = await runGit(execPath, ["branch", "--show-current"]).catch(() => "");
      const directBranch = branchOutput.trim();
      if (directBranch) {
        branch = directBranch;
      } else {
        branch = await resolveDetachedBranch(execPath);
      }
    } catch {
      branch = "main";
    }
  }

  const entries: GitStatusEntry[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.startsWith("##")) continue;

    const x = line.charAt(0);
    const y = line.charAt(1);
    const rawPath = line.slice(2).trim().replace(/^"|"$/g, "");
    if (!rawPath) continue;

    const filePath = rawPath.includes(" -> ") ? (rawPath.split(" -> ")[1] ?? rawPath).trim() : rawPath;
    if (x === "!" && y === "!") continue;

    const isUntracked = x === "?" && y === "?";
    let status: GitStatusEntry["status"];
    if (isUntracked) {
      status = "untracked";
    } else if (x === "D" || y === "D") {
      status = "deleted";
    } else if (x === "A" || y === "A") {
      status = "added";
    } else if (x === "R" || y === "R") {
      status = "renamed";
    } else if (x === "C" || y === "C") {
      status = "copied";
    } else {
      status = "modified";
    }

    const staged = !isUntracked && x !== " " && x !== "?";

    entries.push({
      filePath,
      status,
      staged,
      workingTreeStatus: y === " " ? "  " : ` ${y}`,
      indexStatus: x === " " ? "  " : `${x} `,
    });
  }

  return { branch, ahead, behind, detached, entries, clean: entries.length === 0 };
}

export async function executeGitLog(
  repoPath: string,
  options?: { count?: number; branch?: string },
): Promise<GitLogEntry[]> {
  const count = options?.count ?? 20;
  const ref = options?.branch ?? "HEAD";
  const prettyFormat = "%H|%h|%an|%ae|%ai|%s";
  const output = await runGit(getExecutionPath(repoPath), [
    "log",
    `--max-count=${count}`,
    `--pretty=format:${prettyFormat}`,
    ref,
  ]);

  if (!output.trim()) return [];

  return output
    .replace(/\r/g, "")
    .trim()
    .split("\n")
    .map((line) => {
      const [hash, shortHash, author, email, date, ...rest] = line.split("|");
      return {
        hash: hash ?? "",
        shortHash: shortHash || hash?.substring(0, 7) || "",
        author: author ?? "unknown",
        email: email ?? "",
        date: date ?? "",
        message: rest.join("|") || line,
        branch: ref,
      };
    });
}

export async function executeGitDiff(
  repoPath: string,
  options?: { staged?: boolean; filePath?: string },
): Promise<GitDiffEntry[]> {
  const parts = ["diff"];
  if (options?.staged) parts.push("--cached");
  parts.push("--numstat");
  if (options?.filePath) parts.push("--", options.filePath);

  const output = await runGit(getExecutionPath(repoPath), parts);
  if (!output.trim()) return [];

  return output
    .replace(/\r/g, "")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const tabParts = line.split("\t");
      if (tabParts.length >= 3) {
        const additions = tabParts[0] === "-" ? 0 : parseInt(tabParts[0] ?? "0", 10) || 0;
        const deletions = tabParts[1] === "-" ? 0 : parseInt(tabParts[1] ?? "0", 10) || 0;
        const filePath = tabParts.slice(2).join("\t").replace(/^"|"$/g, "").trim();
        return {
          filePath,
          status: "modified" as const,
          additions,
          deletions,
        };
      }
      return { filePath: line.trim(), status: "modified" as const, additions: 0, deletions: 0 };
    });
}

export async function executeGitBranches(repoPath: string): Promise<GitBranch[]> {
  const execPath = getExecutionPath(repoPath);

  // Try to fetch remote refs so remote branches are up-to-date (silently fail if offline or in test/CI)
  if (process.env.NODE_ENV !== "test" && !process.env.CI) {
    try {
      await execFileAsync("git", ["fetch", "--all", "--prune"], { cwd: execPath, timeout: 15000 });
    } catch {
      // Offline or no remote — continue with existing refs
    }
  }

  const output = await runGit(execPath, ["branch", "-a", "--no-color"]);
  if (!output.trim()) return [];

  const localBranches = new Set<string>();
  const result: GitBranch[] = [];

  // First pass: collect local branches
  const lines = output.replace(/\r/g, "").trim().split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("remotes/")) continue;
    const current = trimmed.startsWith("*");
    const name = trimmed
      .replace(/^\*\s*/, "")
      .replace(/\s+->.*$/, "")
      .trim();
    if (!name || name.includes("HEAD")) continue;
    localBranches.add(name);
    result.push({ name, current, ahead: 0, behind: 0 });
  }

  // Second pass: collect remote branches (exclude ones that already exist as local)
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("remotes/")) continue;
    // Remove "remotes/" prefix to get "origin/branch-name"
    const withoutRemotes = trimmed
      .replace(/^remotes\//, "")
      .replace(/\s+->.*$/, "")
      .trim();
    if (withoutRemotes.includes("HEAD")) continue;
    // Extract remote name and branch name
    const slashIdx = withoutRemotes.indexOf("/");
    if (slashIdx === -1) continue;
    const remoteName = withoutRemotes.slice(0, slashIdx);
    const branchName = withoutRemotes.slice(slashIdx + 1);
    if (!branchName) continue;
    // Only add if no local tracking branch exists
    if (!localBranches.has(branchName)) {
      result.push({
        name: branchName,
        current: false,
        ahead: 0,
        behind: 0,
        remote: remoteName,
      });
    }
  }

  return result;
}

export async function executeGitOperation(
  repoPath: string,
  type: GitOperationType,
  args: string[],
  options?: { dryRun?: boolean; approvalToken?: string },
): Promise<{ output: string; success: boolean }> {
  const op = classifyOperation(type);
  if (op.requiresApproval && !options?.approvalToken) {
    throw new AppError(`Operation ${type} requires approval`, "AUTHORIZATION_ERROR", 403);
  }
  if (options?.dryRun && !op.dryRunSupported) {
    throw new AppError(`Dry run not supported for ${type}`, "VALIDATION_ERROR", 400);
  }
  if (options?.dryRun) {
    return { output: `[DRY RUN] Would execute: git ${type} ${args.join(" ")}`, success: true };
  }

  const output = await runGit(getExecutionPath(repoPath), [type, ...args]);
  return { output, success: true };
}

export function validateGitUrl(url: string): boolean {
  return /^https?:\/\/|git@|ssh:\/\//.test(url);
}

export function getRiskLabel(risk: GitOperationRisk): string {
  return RISK_LABELS[risk];
}

export async function executeGitStashList(repoIdOrPath: string): Promise<GitStashEntry[]> {
  const raw = await runGit(getExecutionPath(repoIdOrPath), ["stash", "list", "--pretty=format:%gd|%cr|%gs"]);
  if (!raw.trim()) return [];
  return raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, idx) => {
      const parts = line.split("|");
      const date = parts[1]?.trim() || "";
      const message = parts.slice(2).join("|").trim() || "WIP";
      const branchMatch = /^(?:WIP\s+on|On)\s+([^:]+)/i.exec(message);
      const branch = branchMatch?.[1]?.trim() || "HEAD";
      return {
        index: idx,
        branch,
        message,
        date,
      };
    });
}

export async function executeGitStashPush(
  repoIdOrPath: string,
  message?: string,
): Promise<{ success: boolean; output: string }> {
  const args = ["stash", "push"];
  if (message && message.trim()) {
    args.push("-m", message.trim());
  }
  const output = await runGit(getExecutionPath(repoIdOrPath), args);
  return { success: true, output };
}

export async function executeGitStashPop(
  repoIdOrPath: string,
  index = 0,
): Promise<{ success: boolean; output: string }> {
  const output = await runGit(getExecutionPath(repoIdOrPath), ["stash", "pop", `stash@{${index}}`]);
  return { success: true, output };
}

export async function executeGitStashDrop(
  repoIdOrPath: string,
  index = 0,
): Promise<{ success: boolean; output: string }> {
  const output = await runGit(getExecutionPath(repoIdOrPath), ["stash", "drop", `stash@{${index}}`]);
  return { success: true, output };
}

export async function executeGitStashShow(repoIdOrPath: string, index = 0): Promise<string> {
  return await runGit(getExecutionPath(repoIdOrPath), ["stash", "show", "-p", `stash@{${index}}`]);
}

export async function executeGitApplyHunk(
  repoIdOrPath: string,
  patchContent: string,
  reverse = false,
): Promise<{ success: boolean; output: string }> {
  const repoPath = getExecutionPath(repoIdOrPath);
  const tempFile = path.join(os.tmpdir(), `git-hunk-${crypto.randomBytes(6).toString("hex")}.patch`);
  try {
    await fs.promises.writeFile(tempFile, patchContent, "utf8");
    const args = ["apply", "--whitespace=nowarn"];
    if (reverse) {
      args.push("--reverse");
    } else {
      args.push("--cached");
    }
    args.push(tempFile);
    const output = await runGit(repoPath, args);
    return { success: true, output: output || "Hunk applied successfully" };
  } finally {
    if (fs.existsSync(tempFile)) {
      await fs.promises.unlink(tempFile).catch(() => {});
    }
  }
}

export async function executeGitDiscardFile(
  repoIdOrPath: string,
  filePath: string,
  staged = false,
): Promise<{ success: boolean; output: string }> {
  const repoPath = getExecutionPath(repoIdOrPath);
  if (staged) {
    const output = await runGit(repoPath, ["restore", "--staged", filePath]);
    return { success: true, output: output || `Unstaged ${filePath}` };
  }
  try {
    const output = await runGit(repoPath, ["restore", filePath]);
    return { success: true, output: output || `Discarded changes in ${filePath}` };
  } catch {
    const output = await runGit(repoPath, ["checkout", "--", filePath]);
    return { success: true, output: output || `Discarded changes in ${filePath}` };
  }
}

export async function executeGitUndoCommit(
  repoIdOrPath: string,
  force = false,
): Promise<{ success: boolean; undoneMessage: string; shortHash: string }> {
  const repoPath = getExecutionPath(repoIdOrPath);
  const shortHash = (await runGit(repoPath, ["rev-parse", "--short", "HEAD"])).trim();
  const undoneMessage = (await runGit(repoPath, ["log", "-1", "--pretty=format:%B"])).trim();

  if (!force) {
    try {
      const upstreamHash = (await runGit(repoPath, ["rev-parse", "@{u}"])).trim();
      const headHash = (await runGit(repoPath, ["rev-parse", "HEAD"])).trim();
      if (upstreamHash === headHash) {
        throw new AppError(
          "Cannot safely undo commit: This commit has already been pushed to the remote branch. Undoing it locally would cause branch divergence.",
          "GIT_ERROR",
          409,
        );
      }
    } catch (err) {
      if (err instanceof AppError) throw err;
      // No upstream configured, safe to proceed
    }
  }

  await runGit(repoPath, ["reset", "--soft", "HEAD~1"]);
  return { success: true, undoneMessage, shortHash };
}

export async function executeGitLogGraph(repoIdOrPath: string, limit = 50): Promise<GitGraphNode[]> {
  const repoPath = getExecutionPath(repoIdOrPath);
  const raw = await runGit(repoPath, [
    "log",
    "--graph",
    `--pretty=format:GRAPH_COMMIT|%h|%p|%an|%ad|%s|%d`,
    "--date=relative",
    `-n`,
    String(Math.min(limit, 100)),
  ]);

  const lines = raw.split(/\r?\n/);
  const nodes: GitGraphNode[] = [];

  for (const line of lines) {
    const commitIdx = line.indexOf("GRAPH_COMMIT|");
    if (commitIdx === -1) continue;

    const graphSymbols = line.slice(0, commitIdx).trimEnd();
    const parts = line.slice(commitIdx + "GRAPH_COMMIT|".length).split("|");
    const hash = parts[0]?.trim() || "";
    const parentStr = parts[1]?.trim() || "";
    const parents = parentStr ? parentStr.split(/\s+/) : [];
    const author = parts[2]?.trim() || "";
    const date = parts[3]?.trim() || "";
    const message = parts[4]?.trim() || "";
    const rawRefs = parts[5]?.trim() || "";
    const refs = rawRefs
      ? rawRefs
          .replace(/[()]/g, "")
          .split(",")
          .map((r) => r.trim())
          .filter(Boolean)
      : [];

    if (hash) {
      nodes.push({
        hash,
        parents,
        author,
        date,
        message,
        refs,
        graphSymbols: graphSymbols || "*",
      });
    }
  }

  return nodes;
}

export function buildGitCommand(type: GitOperationType, ...args: string[]): string {
  const op = classifyOperation(type);
  return `git ${op.command.split(" ")[0]} ${args.join(" ")}`;
}

export { GIT_OPERATION_CATALOG };

async function runGit(repoPath: string, args: string | readonly string[]): Promise<string> {
  try {
    const argArray = typeof args === "string" ? args.split(" ").filter(Boolean) : [...args];
    const { stdout } = await execFileAsync("git", argArray, {
      cwd: repoPath,
      maxBuffer: 10 * 1024 * 1024,
      timeout: 60_000,
    });
    return stdout ?? "";
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string; stderr?: string; stdout?: string };
    if (e.code === "ENOENT") {
      return "";
    }
    throw new AppError(
      `Git command failed: ${e.message ?? "unknown error"}\n${e.stderr ?? e.stdout ?? ""}`,
      "TOOL_ERROR",
      500,
    );
  }
}
