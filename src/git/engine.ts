import fs from "node:fs";
import path from "node:path";
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
} from "../types/git.js";
import { execFileAsync } from "./utils.js";

export type { GitOperationType };

const repositoryPaths = new Map<string, string>();

export function registerRepositoryPath(repositoryId: string, localPath: string): void {
  repositoryPaths.set(repositoryId, localPath);
}

export function getExecutionPath(repositoryOrPath: string): string {
  if (!repositoryOrPath) return process.cwd();
  const mapped = repositoryPaths.get(repositoryOrPath);
  if (mapped && fs.existsSync(mapped)) return mapped;
  if (fs.existsSync(repositoryOrPath)) return repositoryOrPath;
  const cwdGit = path.join(process.cwd(), ".git");
  if (fs.existsSync(cwdGit)) return process.cwd();
  return process.cwd();
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
  const output = await runGit(getExecutionPath(repoPath), "status --porcelain -b");
  const lines = output.trim().split("\n").filter(Boolean);
  const branchLine = lines[0] ?? "";
  const branchMatch = branchLine.match(/^## (?:(.+?)(?:\.\.\.(.+?))?(?:\s*\[(.+?)\])?)$/);

  let branch = "unknown";
  let ahead = 0;
  let behind = 0;
  let detached = false;

  if (branchMatch) {
    let branchName = branchMatch[1] ?? "unknown";
    branchName = branchName.replace("No commits yet on ", "").replace("Initial commit on ", "").trim();
    detached = branchName.includes("no branch") || branchName.includes("HEAD (no branch)");
    branch = detached ? "detached" : branchName;

    const trackingInfo = branchMatch[3];
    const aheadMatch = trackingInfo?.match(/ahead\s+(\d+)/);
    const behindMatch = trackingInfo?.match(/behind\s+(\d+)/);
    ahead = aheadMatch ? parseInt(aheadMatch[1] ?? "0", 10) : 0;
    behind = behindMatch ? parseInt(behindMatch[1] ?? "0", 10) : 0;
  }

  if (branch === "unknown") {
    try {
      const execPath = getExecutionPath(repoPath);
      const branchOutput = await runGit(execPath, ["branch", "--show-current"]).catch(() => "");
      const directBranch = branchOutput.trim();
      if (directBranch) {
        branch = directBranch;
      } else {
        const headOutput = await runGit(execPath, ["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => "");
        const headBranch = headOutput.trim();
        if (headBranch && headBranch !== "HEAD") {
          branch = headBranch;
        } else if (headBranch === "HEAD") {
          branch = "detached";
          detached = true;
        } else {
          branch = "main";
        }
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
    const rawPath = line.substring(3).trim();
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
  parts.push("--stat");
  if (options?.filePath) parts.push("--", options.filePath);

  const output = await runGit(getExecutionPath(repoPath), parts);
  if (!output.trim()) return [];

  return output
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const diffMatch = line.match(/^(.+?)\s+\|\s*(\d+)\s+(\d+)?$/);
      if (!diffMatch) return { filePath: line, status: "modified" as const, additions: 0, deletions: 0 };
      return {
        filePath: diffMatch[1] ?? "",
        status: "modified" as const,
        additions: parseInt(diffMatch[2] ?? "0", 10),
        deletions: parseInt(diffMatch[3] ?? "0", 10),
      };
    });
}

export async function executeGitBranches(repoPath: string): Promise<GitBranch[]> {
  const output = await runGit(getExecutionPath(repoPath), "branch -a --no-color");
  if (!output.trim()) return [];

  return output
    .trim()
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      const current = trimmed.startsWith("*");
      const name = trimmed.replace("* ", "").replace(/^remotes\/[^/]+\//, "");
      const remote = trimmed.startsWith("remotes/") ? trimmed : undefined;
      return { name, current, ahead: 0, behind: 0, ...(remote !== undefined && { remote }) };
    });
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
