import type { NextFunction, Request, Response } from "express";
import {
  classifyOperation,
  executeGitBranches,
  executeGitDiff,
  executeGitLog,
  executeGitOperation,
  executeGitStatus,
  getExecutionPath,
  getRiskLabel,
  GIT_OPERATION_CATALOG,
  type GitOperationType,
} from "../git/engine.js";
import { AppError } from "../errors/app-error.js";
import { conflictAnalyzer } from "../git/conflicts.js";
import { executeSafeCommit } from "../git/commit.js";
import { executeSafePush } from "../git/push.js";
import {
  analyzeAndPlanCommits,
  executeCommitPlan,
} from "../git/change-analyzer.js";
import { getGitHubToken } from "../github/auth.js";
import { createGitHubPR } from "../github/pull-requests.js";

function getGitRequestData(request: Request): Record<string, unknown> {
  const query = request.query as Record<string, unknown>;
  const body =
    typeof request.body === "object" && request.body !== null
      ? (request.body as Record<string, unknown>)
      : {};
  return { ...query, ...body };
}

export async function gitStatusHandler(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = getGitRequestData(request);

    const repoId =
      typeof body.repositoryId === "string" && body.repositoryId.trim()
        ? body.repositoryId.trim()
        : (() => {
          throw new AppError(
            "repositoryId is required",
            "VALIDATION_ERROR",
            400,
          );
        })();

    let status: Awaited<ReturnType<typeof executeGitStatus>>;
    try {
      status = await executeGitStatus(repoId);
    } catch {
      throw new AppError("Repository not accessible", "VALIDATION_ERROR", 400);
    }

    response.status(200).json(status);
  } catch (error) {
    next(error);
  }
}

export async function gitLogHandler(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = getGitRequestData(request);

    const repoId =
      typeof body.repositoryId === "string" && body.repositoryId.trim()
        ? body.repositoryId.trim()
        : (() => {
          throw new AppError(
            "repositoryId is required",
            "VALIDATION_ERROR",
            400,
          );
        })();

    try {
      await executeGitStatus(repoId);
    } catch {
      throw new AppError("Repository not accessible", "VALIDATION_ERROR", 400);
    }

    const count = typeof body.count === "number" ? body.count : 20;
    const branch =
      typeof body.branch === "string" && body.branch.trim()
        ? body.branch.trim()
        : undefined;

    const entries = await executeGitLog(repoId, {
      count,
      ...(branch !== undefined && { branch }),
    });

    response.status(200).json({ commits: entries, entries });
  } catch (error) {
    next(error);
  }
}

export async function gitConflictsHandler(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = getGitRequestData(request);
    const repoId =
      typeof body.repositoryId === "string" && body.repositoryId.trim()
        ? body.repositoryId.trim()
        : undefined;
    if (!repoId) {
      throw new AppError("repositoryId is required", "VALIDATION_ERROR", 400);
    }
    const repoPath = getExecutionPath(repoId);
    const analysis = await conflictAnalyzer.analyzeRepository(repoPath);
    response.status(200).json(analysis);
  } catch (error) {
    next(error);
  }
}

export async function gitConflictResolveHandler(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = getGitRequestData(request);
    const repoId =
      typeof body.repositoryId === "string" && body.repositoryId.trim()
        ? body.repositoryId.trim()
        : undefined;
    if (!repoId) {
      throw new AppError("repositoryId is required", "VALIDATION_ERROR", 400);
    }
    const repoPath = getExecutionPath(repoId);

    if (typeof body.ours === "string" && typeof body.theirs === "string") {
      const filePath = typeof body.filePath === "string" ? body.filePath : "unknown";
      const resolution = await conflictAnalyzer.resolveFile(repoPath, {
        filePath,
        hasConflicts: true,
        markers: [
          {
            filePath,
            startLine: 1,
            endLine: 1,
            baseLines: typeof body.base === "string" ? (body.base as string).split("\n") : [],
            ourLines: (body.ours as string).split("\n"),
            theirLines: (body.theirs as string).split("\n"),
          },
        ],
      });
      response.status(200).json({
        filePath,
        resolution: resolution.resolvedContent,
        strategy: resolution.strategy,
        confidence: resolution.confidence,
        explanation: resolution.explanation,
      });
      return;
    }

    const result = await conflictAnalyzer.resolveAllConflicts(repoPath);
    response.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function gitCommitHandler(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = getGitRequestData(request);
    const repoId =
      typeof body.repositoryId === "string" && body.repositoryId.trim()
        ? body.repositoryId.trim()
        : undefined;
    if (!repoId) {
      throw new AppError("repositoryId is required", "VALIDATION_ERROR", 400);
    }
    const repoPath = getExecutionPath(repoId);
    const message = typeof body.message === "string" ? body.message : undefined;
    const stageAll = body.stageAll !== false;
    const result = await executeSafeCommit(repoPath, {
      ...(message !== undefined ? { message } : {}),
      stageAll,
    });
    response.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    next(error);
  }
}

export async function gitPushHandler(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = getGitRequestData(request);
    const repoId =
      typeof body.repositoryId === "string" && body.repositoryId.trim()
        ? body.repositoryId.trim()
        : undefined;
    if (!repoId) {
      throw new AppError("repositoryId is required", "VALIDATION_ERROR", 400);
    }
    const repoPath = getExecutionPath(repoId);
    const result = await executeSafePush(repoPath, {
      ...(typeof body.remote === "string" ? { remote: body.remote } : {}),
      ...(typeof body.branch === "string" ? { branch: body.branch } : {}),
      setUpstream: body.setUpstream === true,
      forceWithLease: body.forceWithLease === true,
      allowForce: body.allowForce === true,
    });
    response.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    next(error);
  }
}

import { exec } from "node:child_process";
import { promisify } from "node:util";
const execAsync = promisify(exec);

export async function gitPullHandler(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = getGitRequestData(request);
    const repoId =
      typeof body.repositoryId === "string" && body.repositoryId.trim()
        ? body.repositoryId.trim()
        : undefined;
    if (!repoId) {
      throw new AppError("repositoryId is required", "VALIDATION_ERROR", 400);
    }
    const repoPath = getExecutionPath(repoId);
    const remote = typeof body.remote === "string" ? body.remote : "origin";
    const branch = typeof body.branch === "string" ? body.branch : "";
    const rebase = body.rebase === true ? "--rebase" : "";
    const cmd = ["git pull", remote, branch, rebase].filter(Boolean).join(" ");
    try {
      const { stdout, stderr } = await execAsync(cmd, { cwd: repoPath, timeout: 60000 });
      response.status(200).json({
        success: true,
        output: stdout.trim() || stderr.trim() || "Pull completed.",
        remote,
      });
    } catch (err: any) {
      response.status(200).json({
        success: false,
        output: err.stdout || "",
        error: err.stderr || err.message,
        remote,
      });
    }
  } catch (error) {
    next(error);
  }
}

export async function gitFetchHandler(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = getGitRequestData(request);
    const repoId =
      typeof body.repositoryId === "string" && body.repositoryId.trim()
        ? body.repositoryId.trim()
        : undefined;
    if (!repoId) {
      throw new AppError("repositoryId is required", "VALIDATION_ERROR", 400);
    }
    const repoPath = getExecutionPath(repoId);
    const remote = typeof body.remote === "string" ? body.remote : "origin";
    const prune = body.prune !== false ? "--prune" : "";
    const cmd = ["git fetch", remote, prune].filter(Boolean).join(" ");
    try {
      const { stdout, stderr } = await execAsync(cmd, { cwd: repoPath, timeout: 60000 });
      response.status(200).json({
        success: true,
        output: stdout.trim() || stderr.trim() || "Fetch completed.",
        remote,
      });
    } catch (err: any) {
      response.status(200).json({
        success: false,
        output: err.stdout || "",
        error: err.stderr || err.message,
        remote,
      });
    }
  } catch (error) {
    next(error);
  }
}

export async function gitCheckoutHandler(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = getGitRequestData(request);
    const repoId =
      typeof body.repositoryId === "string" && body.repositoryId.trim()
        ? body.repositoryId.trim()
        : undefined;
    if (!repoId) {
      throw new AppError("repositoryId is required", "VALIDATION_ERROR", 400);
    }
    const branch = typeof body.branch === "string" && body.branch.trim()
      ? body.branch.trim()
      : undefined;
    if (!branch) {
      throw new AppError("branch is required", "VALIDATION_ERROR", 400);
    }
    const repoPath = getExecutionPath(repoId);
    const createNew = body.create === true;
    const cmd = createNew ? `git checkout -b ${branch}` : `git checkout ${branch}`;
    try {
      const { stdout, stderr } = await execAsync(cmd, { cwd: repoPath, timeout: 30000 });
      response.status(200).json({
        success: true,
        branch,
        output: stdout.trim() || stderr.trim() || `Switched to branch '${branch}'.`,
      });
    } catch (err: any) {
      response.status(200).json({
        success: false,
        branch,
        output: err.stdout || "",
        error: err.stderr || err.message,
      });
    }
  } catch (error) {
    next(error);
  }
}

export async function gitDiffHandler(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = getGitRequestData(request);

    const repoId =
      typeof body.repositoryId === "string" && body.repositoryId.trim()
        ? body.repositoryId.trim()
        : (() => {
          throw new AppError(
            "repositoryId is required",
            "VALIDATION_ERROR",
            400,
          );
        })();

    try {
      await executeGitStatus(repoId);
    } catch {
      throw new AppError("Repository not accessible", "VALIDATION_ERROR", 400);
    }

    const staged = body.staged === true;
    const filePath =
      typeof body.filePath === "string" && body.filePath.trim()
        ? body.filePath.trim()
        : undefined;

    const diff = await executeGitDiff(repoId, {
      ...(staged && { staged }),
      ...(filePath !== undefined && { filePath }),
    });

    response.status(200).json(diff);
  } catch (error) {
    next(error);
  }
}

export async function gitBranchesHandler(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = getGitRequestData(request);

    const repoId =
      typeof body.repositoryId === "string" && body.repositoryId.trim()
        ? body.repositoryId.trim()
        : (() => {
          throw new AppError(
            "repositoryId is required",
            "VALIDATION_ERROR",
            400,
          );
        })();

    try {
      await executeGitStatus(repoId);
    } catch {
      throw new AppError("Repository not accessible", "VALIDATION_ERROR", 400);
    }

    const branches = await executeGitBranches(repoId);

    response.status(200).json(branches);
  } catch (error) {
    next(error);
  }
}

export async function gitExecuteHandler(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { operation } = request.params;
    const opType = operation as GitOperationType;

    const catalogEntry = GIT_OPERATION_CATALOG.find((op) => op.type === opType);
    if (!catalogEntry) {
      throw new AppError(
        `Unknown git operation: ${operation}`,
        "VALIDATION_ERROR",
        400,
      );
    }

    const body =
      typeof request.body === "object" && request.body !== null
        ? (request.body as Record<string, unknown>)
        : {};

    const repoId =
      typeof body.repositoryId === "string" && body.repositoryId.trim()
        ? body.repositoryId.trim()
        : (() => {
          throw new AppError(
            "repositoryId is required",
            "VALIDATION_ERROR",
            400,
          );
        })();

    try {
      await executeGitStatus(repoId);
    } catch {
      throw new AppError("Repository not accessible", "VALIDATION_ERROR", 400);
    }

    const args = Array.isArray(body.args) ? (body.args as string[]) : [];

    const approvalTokenStr =
      typeof body.approvalToken === "string" ? body.approvalToken : undefined;

    const result = await executeGitOperation(
      repoId,
      opType,
      args,
      approvalTokenStr !== undefined
        ? {
          dryRun: body.dryRun === true,
          approvalToken: approvalTokenStr,
        }
        : { dryRun: body.dryRun === true },
    );

    response.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function gitOperationCatalogHandler(
  _request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const catalog = GIT_OPERATION_CATALOG.map((op) => ({
      type: op.type,
      risk: op.risk,
      riskLabel: getRiskLabel(op.risk),
      command: op.command,
      description: op.description,
      requiresApproval: op.requiresApproval,
      dryRunSupported: op.dryRunSupported,
    }));

    response.status(200).json(catalog);
  } catch (error) {
    next(error);
  }
}

export async function gitClassifyHandler(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { operation } = request.params;
    const op = classifyOperation(operation as GitOperationType);

    response.status(200).json({
      type: op.type,
      risk: op.risk,
      riskLabel: getRiskLabel(op.risk),
      requiresApproval: op.requiresApproval,
      dryRunSupported: op.dryRunSupported,
      description: op.description,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * AI Change Analysis:
 * Inspects modified/untracked files, AST relations, groups into logical changes,
 * and generates Conventional Commit plans.
 */
export async function gitAnalyzeChangesHandler(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = getGitRequestData(request);
    const repoId =
      typeof body.repositoryId === "string" && body.repositoryId.trim()
        ? body.repositoryId.trim()
        : (() => {
          throw new AppError("repositoryId is required", "VALIDATION_ERROR", 400);
        })();

    const repoPath = getExecutionPath(repoId);
    const plan = await analyzeAndPlanCommits(repoPath);

    response.status(200).json({
      success: true,
      plan,
      summary: plan.summary,
      totalFiles: plan.totalFiles,
      totalCommits: plan.totalCommits,
      groups: plan.groups,
      changedFiles: plan.changedFiles,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * AI Commit All / Execute Commit Plan:
 * Atomically stages each logical group's files and creates sequential commits
 * with real SHA verification. Never blindly runs `git add .`.
 */
export async function gitExecuteCommitPlanHandler(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = getGitRequestData(request);
    const repoId =
      typeof body.repositoryId === "string" && body.repositoryId.trim()
        ? body.repositoryId.trim()
        : (() => {
          throw new AppError("repositoryId is required", "VALIDATION_ERROR", 400);
        })();

    const repoPath = getExecutionPath(repoId);
    let groups = Array.isArray(body.groups) ? body.groups : undefined;

    // If groups not provided, analyze on the fly
    if (!groups || groups.length === 0) {
      const plan = await analyzeAndPlanCommits(repoPath);
      groups = plan.groups;
    }

    if (!groups || groups.length === 0) {
      response.status(200).json({
        success: false,
        message: "No change groups to commit.",
        commits: [],
        totalCreated: 0,
      });
      return;
    }

    const result = await executeCommitPlan(repoPath, groups);
    response.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * Git Sync:
 * Fetches remote metadata, checks ahead/behind status, and safely pulls or warns of conflicts.
 */
export async function gitSyncHandler(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = getGitRequestData(request);
    const repoId =
      typeof body.repositoryId === "string" && body.repositoryId.trim()
        ? body.repositoryId.trim()
        : (() => {
          throw new AppError("repositoryId is required", "VALIDATION_ERROR", 400);
        })();

    const repoPath = getExecutionPath(repoId);
    const remote = typeof body.remote === "string" ? body.remote : "origin";

    // 1. Fetch remote refs
    try {
      await execAsync(`git fetch ${remote} --prune`, { cwd: repoPath, timeout: 45_000 });
    } catch (err: any) {
      console.warn("[gitSync] Fetch warning:", err.message);
    }

    // 2. Check status and ahead/behind counts
    const status = await executeGitStatus(repoId);
    let actionRequired: "none" | "push" | "pull" | "diverged" | "commit_required" = "none";
    let message = "Repository is in sync with remote.";

    if (!status.clean) {
      actionRequired = "commit_required";
      message = "Uncommitted local changes present. Commit or stash before syncing.";
    } else if (status.ahead > 0 && status.behind > 0) {
      actionRequired = "diverged";
      message = `Branches have diverged (${status.ahead} ahead, ${status.behind} behind). Rebase or merge required.`;
    } else if (status.behind > 0) {
      actionRequired = "pull";
      // Perform safe pull
      try {
        const { stdout } = await execAsync(`git pull ${remote}`, { cwd: repoPath, timeout: 60_000 });
        message = `Successfully pulled remote changes. ${stdout.trim()}`;
        actionRequired = "none";
      } catch (pullErr: any) {
        message = `Pull encountered conflicts or issues: ${pullErr.message}`;
      }
    } else if (status.ahead > 0) {
      actionRequired = "push";
      message = `Local branch is ${status.ahead} commit(s) ahead of remote. Ready to push.`;
    }

    const updatedStatus = await executeGitStatus(repoId);

    response.status(200).json({
      success: true,
      branch: updatedStatus.branch,
      ahead: updatedStatus.ahead,
      behind: updatedStatus.behind,
      clean: updatedStatus.clean,
      actionRequired,
      message,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * AI Ship:
 * High-velocity workflow: Analyze Changes -> Create Commit Plan -> Commit All Groups -> Push -> Create PR.
 */
export async function gitShipHandler(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = getGitRequestData(request);
    const repoId =
      typeof body.repositoryId === "string" && body.repositoryId.trim()
        ? body.repositoryId.trim()
        : (() => {
          throw new AppError("repositoryId is required", "VALIDATION_ERROR", 400);
        })();

    const repoPath = getExecutionPath(repoId);
    const targetBranch = typeof body.targetBranch === "string" && body.targetBranch ? body.targetBranch : "main";
    const prTitle = typeof body.prTitle === "string" ? body.prTitle : undefined;

    // 1. Analyze and group changes
    const plan = await analyzeAndPlanCommits(repoPath);
    if (plan.groups.length === 0) {
      // Check if already ahead and just needs push/PR
      const status = await executeGitStatus(repoId);
      if (status.ahead === 0) {
        response.status(200).json({
          success: false,
          message: "No changes to ship and working tree is in sync.",
        });
        return;
      }
    }

    // 2. Commit all groups if changes exist
    let commitResult = { success: true, commits: [] as any[], totalCreated: 0 };
    if (plan.groups.length > 0) {
      const execRes = await executeCommitPlan(repoPath, plan.groups);
      if (!execRes.success) {
        response.status(400).json({
          success: false,
          message: `Commit step failed: ${execRes.message}`,
          error: execRes.error,
        });
        return;
      }
      commitResult = execRes;
    }

    // 3. Push to remote
    const pushResult = await executeSafePush(repoPath, { setUpstream: true });
    if (!pushResult.success) {
      response.status(400).json({
        success: false,
        message: `Push step failed: ${pushResult.error || pushResult.output || "Unknown push error"}`,
        error: pushResult.error,
        commits: commitResult.commits,
      });
      return;
    }

    // 4. Determine PR details
    const branchStatus = await executeGitStatus(repoId);
    const sourceBranch = branchStatus.branch;
    let prData: any = null;

    // Parse owner/repo from remote URL or body
    let owner = typeof body.owner === "string" ? body.owner : "";
    let repoName = typeof body.repo === "string" ? body.repo : "";
    if (!owner || !repoName) {
      try {
        const { stdout: remoteUrl } = await execAsync("git remote get-url origin", { cwd: repoPath, timeout: 10000 });
        const match = /github\.com[/:]([^/]+)\/([^/.]+)/.exec(remoteUrl.trim());
        if (match && match[1] && match[2]) {
          owner = match[1];
          repoName = match[2];
        }
      } catch { }
    }

    // If GitHub credentials connected, attempt PR creation
    const userId = (request as unknown as { user?: { id?: string } }).user?.id ?? "anonymous";
    const token = getGitHubToken(userId);

    if (token && owner && repoName && sourceBranch !== targetBranch) {
      try {
        const title = prTitle || commitResult.commits[0]?.commitMessage || `feat: ship updates on ${sourceBranch}`;
        const prBody = `### 🚀 AI Ship Automated Pull Request\n\n**Source Branch:** \`${sourceBranch}\`\n**Target Branch:** \`${targetBranch}\`\n\n#### 📦 Commits Included (${commitResult.commits.length}):\n${commitResult.commits.map((c: any) => `- \`${c.commitHash}\`: ${c.commitMessage} (${c.files.length} files)`).join("\n")}\n\n*Verified and shipped automatically by AI Git Debugging Agent.*`;

        const pr = await createGitHubPR(userId, owner, repoName, {
          title,
          body: prBody,
          head: sourceBranch,
          base: targetBranch,
        });
        prData = {
          id: pr.id,
          number: pr.number,
          url: pr.htmlUrl,
          title: pr.title,
        };
      } catch (prErr: any) {
        console.warn("[gitShip] PR creation warning:", prErr.message);
      }
    }

    response.status(200).json({
      success: true,
      message: `Shipped successfully: ${commitResult.totalCreated} commit(s) pushed on '${sourceBranch}'.${prData ? ` PR #${prData.number} created.` : ""}`,
      branch: sourceBranch,
      commits: commitResult.commits,
      pushed: true,
      pr: prData,
    });
  } catch (error) {
    next(error);
  }
}

