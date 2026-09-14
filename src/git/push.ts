import { executeGitStatus, isProtectedBranch } from "./engine.js";
import { safeExec, validateBranchName, validateRemoteName, escapeShellArg } from "./utils.js";

export interface PushOptions {
  readonly remote?: string;
  readonly branch?: string;
  readonly setUpstream?: boolean;
  readonly forceWithLease?: boolean;
  readonly force?: boolean;
  readonly allowForce?: boolean;
}

export interface PrePushCheckResult {
  readonly canPush: boolean;
  readonly currentBranch: string;
  readonly ahead: number;
  readonly behind: number;
  readonly hasUncommittedChanges: boolean;
  readonly isProtected: boolean;
  readonly warnings: readonly string[];
  readonly error?: string;
}

export interface PushResult {
  readonly success: boolean;
  readonly branch: string;
  readonly remote: string;
  readonly output: string;
  readonly error?: string;
}

export async function validatePrePush(repoPath: string, options: PushOptions = {}): Promise<PrePushCheckResult> {
  const warnings: string[] = [];

  try {
    const status = await executeGitStatus(repoPath);
    const currentBranch = status.branch || "HEAD";
    const targetBranch = options.branch ?? currentBranch;
    const isProtected = isProtectedBranch(targetBranch);

    if (isProtected) warnings.push(`Branch "${targetBranch}" is a protected branch. Direct push should be restricted to verified release flows.`);
    if (!status.clean) warnings.push("Working tree has uncommitted changes. Consider committing or stashing before pushing.");

    const base = { currentBranch, ahead: status.ahead, behind: status.behind, hasUncommittedChanges: !status.clean, isProtected, warnings };

    if (status.behind > 0) return { ...base, canPush: false, error: `Local branch is ${status.behind} commit(s) behind remote. Pull and merge before pushing.` };
    if (options.force && !options.allowForce) return { ...base, canPush: false, error: "Naked force-push is rejected by safety policy. Use --force-with-lease with explicit override if required." };
    if (isProtected && (options.force || options.forceWithLease)) return { ...base, canPush: false, error: `Force-push to protected branch "${targetBranch}" is strictly prohibited.` };

    return { ...base, canPush: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { canPush: false, currentBranch: "unknown", ahead: 0, behind: 0, hasUncommittedChanges: false, isProtected: false, warnings, error: `Pre-push validation failed: ${msg}` };
  }
}

export async function executeSafePush(repoPath: string, options: PushOptions = {}): Promise<PushResult> {
  const preCheck = await validatePrePush(repoPath, options);
  if (!preCheck.canPush) return { success: false, branch: preCheck.currentBranch, remote: options.remote ?? "origin", output: "", error: preCheck.error ?? "Pre-push check failed" };

  const remote = options.remote?.trim() ? validateRemoteName(options.remote) : "origin";
  const branch = options.branch?.trim() ? validateBranchName(options.branch) : preCheck.currentBranch;
  const refSpec = branch === preCheck.currentBranch ? branch : `${preCheck.currentBranch}:${branch}`;
  const escapedRemote = escapeShellArg(remote);
  const escapedRefSpec = escapeShellArg(refSpec);

  const flags = [
    options.setUpstream ? "-u" : "",
    options.forceWithLease && options.allowForce ? "--force-with-lease" : "",
  ].filter(Boolean).join(" ");

  const cmd = `git push ${flags} ${escapedRemote} ${escapedRefSpec}`.replace(/\s+/g, " ").trim();

  try {
    const { stdout, stderr } = await safeExec(cmd, repoPath);
    return { success: true, branch, remote, output: stdout.trim() || stderr.trim() || "Push completed successfully." };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return { success: false, branch, remote, output: e.stdout ?? "", error: e.stderr ?? e.message ?? "Unknown push error" };
  }
}
