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

export type { GitOperationType };

const repositoryPaths = new Map<string, string>();

export function registerRepositoryPath(repositoryId: string, localPath: string): void {
  repositoryPaths.set(repositoryId, localPath);
}

export function getExecutionPath(repositoryOrPath: string): string {
  return repositoryPaths.get(repositoryOrPath) ?? repositoryOrPath;
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

const PROTECTED_BRANCH_PATTERNS = [
  "main",
  "master",
  "production",
  "release",
  "develop",
  "staging",
];

export function classifyOperation(type: GitOperationType): GitOperation {
  const op = GIT_OPERATION_CATALOG.find((o) => o.type === type);
  if (!op) {
    throw new AppError(
      `Unknown git operation: ${type}`,
      "VALIDATION_ERROR",
      400,
    );
  }
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

export async function executeGitStatus(
  repoPath: string,
): Promise<GitStatusOutput> {
  const output = await runGit(getExecutionPath(repoPath), "status --porcelain -b");
  const lines = output.trim().split("\n").filter(Boolean);

  const branchLine = lines[0] ?? "";
  const branchMatch = branchLine.match(
    /^## (?:(.+?)(?:\.\.\.(.+))?(?:\s*\[(.+)\])?)$/,
  );
  let branch = "unknown";
  let ahead = 0;
  let behind = 0;
  let detached = false;

  if (branchMatch) {
    let branchName = branchMatch[1] ?? "unknown";
    if (branchName.startsWith("No commits yet on ")) {
      branchName = branchName.replace("No commits yet on ", "").trim();
    }
    branch = branchName;
    detached = branchName === "(no branch)" || branchName.includes("no branch");
    if (detached) branch = "detached";

    const trackingInfo = branchMatch[3];
    if (trackingInfo) {
      const aheadMatch = trackingInfo.match(/ahead\s+(\d+)/);
      const behindMatch = trackingInfo.match(/behind\s+(\d+)/);
      if (aheadMatch && aheadMatch[1]) ahead = parseInt(aheadMatch[1], 10);
      if (behindMatch && behindMatch[1]) behind = parseInt(behindMatch[1], 10);
    }
  }

  const entries: GitStatusEntry[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.startsWith("##")) continue;

    const indexStatus = line.substring(0, 2);
    const workTreeStatus = line.substring(2, 4);
    const filePath = line.substring(3).trim();

    const statusChar = (idx: string): GitStatusEntry["status"] => {
      if (idx.startsWith("??")) return "untracked";
      if (idx.startsWith("!!")) return "ignored";
      if (idx.startsWith("A")) return "added";
      if (idx.startsWith("M")) return "modified";
      if (idx.startsWith("D")) return "deleted";
      if (idx.startsWith("R")) return "renamed";
      if (idx.startsWith("C")) return "copied";
      return "modified";
    };

    entries.push({
      filePath,
      status:
        workTreeStatus !== "  "
          ? statusChar(workTreeStatus)
          : statusChar(indexStatus),
      staged: indexStatus !== " " && indexStatus !== "? ",
      workingTreeStatus: workTreeStatus,
      indexStatus,
    });
  }

  return {
    branch,
    ahead,
    behind,
    detached,
    entries,
    clean: entries.length === 0,
  };
}

export async function executeGitLog(
  repoPath: string,
  options?: { count?: number; branch?: string },
): Promise<GitLogEntry[]> {
  const count = options?.count ?? 20;
  const ref = options?.branch ?? "HEAD";
  const cmd = `log --oneline -${count} --pretty=format:%H|%h|%an|%ae|%ai|%s ${ref}`;
  const output = await runGit(getExecutionPath(repoPath), cmd);
  if (!output.trim()) return [];

  return output
    .trim()
    .split("\n")
    .map((line) => {
      const parts = line.split("|");
      const hash = parts[0] ?? "";
      const shortHash =
        (parts[1] ?? hash.substring(0, 7)) || hash.substring(0, 7);
      const author = parts[2] ?? "unknown";
      const email = parts[3] ?? "";
      const date = parts[4] ?? "";
      const message = parts[5] ?? line;
      return {
        hash,
        shortHash,
        author,
        email,
        date,
        message,
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
  const cmd = parts.join(" ");

  const output = await runGit(getExecutionPath(repoPath), cmd);
  if (!output.trim()) return [];

  return output
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const diffMatch = line.match(/^(.+?)\s+\|\s*(\d+)\s+(\d+)?$/);
      if (diffMatch) {
        return {
          filePath: diffMatch[1] ?? "",
          status: "modified" as const,
          additions: parseInt(diffMatch[2] || "0", 10),
          deletions: parseInt(diffMatch[3] || "0", 10),
        };
      }
      return {
        filePath: line,
        status: "modified" as const,
        additions: 0,
        deletions: 0,
      };
    });
}

export async function executeGitBranches(
  repoPath: string,
): Promise<GitBranch[]> {
  const output = await runGit(getExecutionPath(repoPath), "branch -a --no-color");
  if (!output.trim()) return [];

  return output
    .trim()
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      const current = trimmed.startsWith("*");
      const name = trimmed.replace("* ", "").replace(/^remotes\/[^\/]+\//, "");
      const remote = trimmed.startsWith("remotes/") ? trimmed : undefined;
      return {
        name,
        current,
        ahead: 0,
        behind: 0,
        ...(remote !== undefined && { remote }),
      };
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
    throw new AppError(
      `Operation ${type} requires approval`,
      "AUTHORIZATION_ERROR",
      403,
    );
  }

  if (options?.dryRun && !op.dryRunSupported) {
    throw new AppError(
      `Dry run not supported for ${type}`,
      "VALIDATION_ERROR",
      400,
    );
  }

  if (options?.dryRun) {
    return {
      output: `[DRY RUN] Would execute: git ${type} ${args.join(" ")}`,
      success: true,
    };
  }

  const output = await runGit(getExecutionPath(repoPath), `${type} ${args.join(" ")}`);
  return { output, success: true };
}

async function runGit(repoPath: string, args: string): Promise<string> {
  const { execFile } = await import("node:child_process");

  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args.split(" ").filter(Boolean),
      {
        cwd: repoPath,
        maxBuffer: 10 * 1024 * 1024,
        timeout: 60_000,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new AppError(
              `Git command failed: ${error.message}\n${stderr || stdout}`,
              "TOOL_ERROR",
              500,
            ),
          );
          return;
        }
        resolve(stdout || "");
      },
    );
  });
}

export function validateGitUrl(url: string): boolean {
  return /^https?:\/\/|git@|ssh:\/\//.test(url);
}

export function getRiskLabel(risk: GitOperationRisk): string {
  const labels: Record<GitOperationRisk, string> = {
    safe: "read-only",
    controlled: "requires-approval",
    dangerous: "requires-review",
  };
  return labels[risk];
}

export function buildGitCommand(
  type: GitOperationType,
  ...args: string[]
): string {
  const op = classifyOperation(type);
  return `git ${op.command.split(" ")[0]} ${args.join(" ")}`;
}

export { GIT_OPERATION_CATALOG };
