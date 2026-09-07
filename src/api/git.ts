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
