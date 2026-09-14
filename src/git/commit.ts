import { callLlm, isLlmAvailable } from "../llm/client.js";
import { repositoryStore } from "../repositories/repository-store.js";
import { safeExec, validateFilePath } from "./utils.js";

export interface ConventionalCommit {
  readonly type: "fix" | "feat" | "refactor" | "test" | "docs" | "style" | "chore" | "perf" | "ci" | "build" | "revert";
  readonly scope?: string;
  readonly subject: string;
  readonly body?: string;
  readonly footer?: string;
  readonly breakingChange: boolean;
}

export interface CommitResult {
  readonly success: boolean;
  readonly commitHash?: string;
  readonly message: string;
  readonly error?: string;
}

export function formatCommitMessage(commit: ConventionalCommit): string {
  const scopePart = commit.scope ? `(${commit.scope})` : "";
  const breakingMark = commit.breakingChange ? "!" : "";
  const header = `${commit.type}${scopePart}${breakingMark}: ${commit.subject}`;

  const parts = [header];
  if (commit.body) parts.push("", commit.body);
  if (commit.breakingChange && commit.footer) parts.push("", `BREAKING CHANGE: ${commit.footer}`);
  if (!commit.breakingChange && commit.footer) parts.push("", commit.footer);
  return parts.join("\n");
}

export async function generateCommitMessage(
  rootCause: string,
  filesChanged: string[],
  query: string,
): Promise<ConventionalCommit> {
  if (isLlmAvailable()) {
    try {
      const response = await callLlm([
        {
          role: "system",
          content: `Generate a conventional commit message. Respond ONLY with JSON:\n{"type":"fix|feat|refactor|test|docs|style|chore|perf|ci|build|revert","scope":"optional","subject":"short imperative max 72 chars","body":"optional","footer":"optional","breakingChange":false}`,
        },
        {
          role: "user",
          content: `Debug task: "${query}"\nRoot cause: ${rootCause}\nFiles changed: ${filesChanged.join(", ")}`,
        },
      ]);
      const jsonMatch = /\{[\s\S]*\}/.exec(response.content);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as ConventionalCommit;
        return {
          type: parsed.type ?? "fix",
          ...(parsed.scope ? { scope: parsed.scope } : {}),
          subject: (parsed.subject ?? "resolve issue").slice(0, 72),
          ...(parsed.body ? { body: parsed.body } : {}),
          ...(parsed.footer ? { footer: parsed.footer } : {}),
          breakingChange: parsed.breakingChange ?? false,
        };
      }
    } catch {
      // Fall through to heuristic commit generation
    }
  }

  const scope = filesChanged[0]?.split("/").slice(-2, -1)[0];
  return {
    type: "fix",
    ...(scope ? { scope } : {}),
    subject: `resolve issue: ${query.slice(0, 60)}`,
    body: `Root cause: ${rootCause}`,
    breakingChange: false,
  };
}

export async function executeSafeCommit(
  repoPath: string,
  options: { message?: string; stageAll?: boolean; files?: string[] } = {},
): Promise<CommitResult> {
  const commitMsg = options.message ?? "fix: apply automated patch";

  if (options.files && options.files.length > 0) {
    for (const f of options.files) {
      await safeExec(`git add "${validateFilePath(f)}"`, repoPath);
    }
  } else if (options.stageAll !== false) {
    await safeExec("git add -A", repoPath);
  }

  const { stdout: statusOut } = await safeExec("git status --porcelain", repoPath);
  if (!statusOut.trim()) return { success: false, message: "Nothing to commit — working tree clean." };

  const escapedMsg = commitMsg.replace(/"/g, '\\"').replace(/`/g, "\\`");
  try {
    const { stdout } = await safeExec(`git commit -m "${escapedMsg}"`, repoPath);
    const hashMatch = /\[(?:.+?\s+)?([a-f0-9]{7,40})\]/.exec(stdout);
    const commitHash = hashMatch?.[1] ?? (await resolveHeadHash(repoPath));
    return {
      success: true,
      ...(commitHash ? { commitHash } : {}),
      message: `Committed successfully: ${commitMsg.slice(0, 60)}`,
    };
  } catch (err: unknown) {
    return { success: false, message: "Commit failed", error: err instanceof Error ? err.message : String(err) };
  }
}

export async function safeCommit(
  repositoryId: string,
  tenantId: string,
  commitMessage: string,
  filesToStage?: string[],
): Promise<CommitResult> {
  const repoPath = resolveRepoPath(repositoryId, tenantId);
  if (!repoPath) return { success: false, message: "Repository not found", error: "Repository not found in store" };

  try {
    if (filesToStage?.length) {
      for (const f of filesToStage) await safeExec(`git add "${validateFilePath(f)}"`, repoPath);
    } else {
      await safeExec("git add -A", repoPath);
    }

    const { stdout: statusOut } = await safeExec("git status --porcelain", repoPath);
    if (!statusOut.trim()) return { success: false, message: "Nothing to commit — working tree clean." };

    const escapedMsg = commitMessage.replace(/"/g, '\\"').replace(/`/g, "\\`");
    const { stdout } = await safeExec(`git commit -m "${escapedMsg}"`, repoPath);
    const hashMatch = /\[[\w/]+ ([a-f0-9]+)\]/.exec(stdout);
    return {
      success: true,
      ...(hashMatch?.[1] ? { commitHash: hashMatch[1] } : {}),
      message: `Committed successfully: ${commitMessage.slice(0, 60)}`,
    };
  } catch (err: unknown) {
    return { success: false, message: "Commit failed", error: err instanceof Error ? err.message : String(err) };
  }
}

export async function safePush(
  repositoryId: string,
  tenantId: string,
  branch?: string,
  options: { dryRun?: boolean; force?: boolean } = {},
): Promise<CommitResult> {
  if (options.force)
    return {
      success: false,
      message: "Force push is disabled by safety policy. Use a PR instead.",
      error: "FORCE_PUSH_BLOCKED",
    };

  const repoPath = resolveRepoPath(repositoryId, tenantId);
  if (!repoPath) return { success: false, message: "Repository not found", error: "Repository not found in store" };

  try {
    const { stdout: statusOut } = await safeExec("git status --porcelain", repoPath);
    if (statusOut.trim())
      return {
        success: false,
        message: "Working tree has uncommitted changes. Commit or stash them before pushing.",
        error: "UNCOMMITTED_CHANGES",
      };

    const branchArg = branch ? `HEAD:${branch.replace(/[^a-zA-Z0-9._/-]/g, "_")}` : "";
    const dryRunFlag = options.dryRun ? "--dry-run" : "";
    const cmd = `git push origin ${branchArg} ${dryRunFlag}`.trim();
    const { stdout } = await safeExec(cmd, repoPath);

    return {
      success: true,
      message: options.dryRun
        ? `Dry run push succeeded. Branch: ${branch ?? "current"}`
        : `Pushed successfully to origin/${branch ?? "current branch"}`,
      commitHash: stdout.slice(0, 50),
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      message: "Push failed",
      error: msg.includes("rejected") ? "Push rejected by remote — you may need to pull first." : msg,
    };
  }
}

function resolveRepoPath(repositoryId: string, tenantId: string): string | null {
  try {
    const repo = repositoryStore.getRepository(repositoryId, tenantId);
    return repo?.localPath ?? repo?.url?.replace("file://", "") ?? null;
  } catch {
    return null;
  }
}

async function resolveHeadHash(repoPath: string): Promise<string | undefined> {
  try {
    const { stdout: revOut } = await safeExec("git rev-parse --short HEAD", repoPath);
    return revOut.trim() || undefined;
  } catch {
    return undefined;
  }
}
