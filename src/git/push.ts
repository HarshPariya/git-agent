/**
 * Safe Push Workflow
 * Enforces pre-push validations, working tree sanity checks,
 * and protected branch / force-push safeguards.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { executeGitStatus, isProtectedBranch } from "./engine.js";

const execAsync = promisify(exec);

export interface PushOptions {
  readonly remote?: string;
  readonly branch?: string;
  readonly setUpstream?: boolean;
  readonly forceWithLease?: boolean;
  readonly force?: boolean; // Naked force is forbidden by default
  readonly allowForce?: boolean; // Must explicitly allow force operations
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

const safeExec = async (
  cmd: string,
  cwd: string,
): Promise<{ stdout: string; stderr: string }> => {
  return execAsync(cmd, { cwd, timeout: 45_000 });
};

/**
 * Validates working tree and branch state before initiating a push
 */
export async function validatePrePush(
  repoPath: string,
  options: PushOptions = {},
): Promise<PrePushCheckResult> {
  const warnings: string[] = [];

  try {
    const status = await executeGitStatus(repoPath);

    const currentBranch = status.branch || "HEAD";
    const targetBranch = options.branch || currentBranch;
    const isProtected = isProtectedBranch(targetBranch);

    if (isProtected) {
      warnings.push(
        `Branch "${targetBranch}" is a protected branch. Direct push should be restricted to verified release flows.`,
      );
    }

    const hasUncommittedChanges = !status.clean;
    if (hasUncommittedChanges) {
      warnings.push(
        "Working tree has uncommitted changes. Consider committing or stashing before pushing.",
      );
    }

    if (status.behind > 0) {
      return {
        canPush: false,
        currentBranch,
        ahead: status.ahead,
        behind: status.behind,
        hasUncommittedChanges,
        isProtected,
        warnings,
        error: `Local branch is ${status.behind} commit(s) behind remote. Pull and merge before pushing.`,
      };
    }

    if (options.force && !options.allowForce) {
      return {
        canPush: false,
        currentBranch,
        ahead: status.ahead,
        behind: status.behind,
        hasUncommittedChanges,
        isProtected,
        warnings,
        error: "Naked force-push is rejected by safety policy. Use --force-with-lease with explicit override if required.",
      };
    }

    if (isProtected && (options.force || options.forceWithLease)) {
      return {
        canPush: false,
        currentBranch,
        ahead: status.ahead,
        behind: status.behind,
        hasUncommittedChanges,
        isProtected,
        warnings,
        error: `Force-push to protected branch "${targetBranch}" is strictly prohibited.`,
      };
    }

    return {
      canPush: true,
      currentBranch,
      ahead: status.ahead,
      behind: status.behind,
      hasUncommittedChanges,
      isProtected,
      warnings,
    };
  } catch (err: any) {
    return {
      canPush: false,
      currentBranch: "unknown",
      ahead: 0,
      behind: 0,
      hasUncommittedChanges: false,
      isProtected: false,
      warnings,
      error: `Pre-push validation failed: ${err.message}`,
    };
  }
}

/**
 * Safely executes git push with comprehensive guardrails
 */
export async function executeSafePush(
  repoPath: string,
  options: PushOptions = {},
): Promise<PushResult> {
  const preCheck = await validatePrePush(repoPath, options);
  if (!preCheck.canPush) {
    return {
      success: false,
      branch: preCheck.currentBranch,
      remote: options.remote || "origin",
      output: "",
      error: preCheck.error || "Pre-push check failed",
    };
  }

  const remote = options.remote || "origin";
  const branch = options.branch || preCheck.currentBranch;

  let cmd = `git push ${remote} ${branch}`;

  if (options.setUpstream) {
    cmd = `git push -u ${remote} ${branch}`;
  }

  if (options.forceWithLease && options.allowForce) {
    cmd += " --force-with-lease";
  }

  try {
    const { stdout, stderr } = await safeExec(cmd, repoPath);
    return {
      success: true,
      branch,
      remote,
      output: stdout.trim() || stderr.trim() || "Push completed successfully.",
    };
  } catch (err: any) {
    return {
      success: false,
      branch,
      remote,
      output: err.stdout || "",
      error: err.stderr || err.message,
    };
  }
}
