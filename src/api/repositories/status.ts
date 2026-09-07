import type { Request, Response, NextFunction } from "express";
import { repositoryStore } from "../../repositories/repository-store.js";
import { AppError } from "../../errors/app-error.js";
import { executeGitStatus, executeGitLog } from "../../git/engine.js";
import { executeGitBranches } from "../../git/engine.js";

export async function getRepositoryStatusHandler(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const context =
      request.tenantContext ??
      (() => {
        throw new AppError(
          "Tenant context is missing",
          "AUTHENTICATION_ERROR",
          401,
        );
      })();

    const repositoryId = request.params.id as string;

    try {
      const repo = repositoryStore.getRepository(repositoryId, context.tenantId);

      if (!repo) {
        throw new AppError("Repository not found", "NOT_FOUND", 404);
      }

      const gitStatus = await executeGitStatus(repo.localPath);
      const branches = await executeGitBranches(repo.localPath);
      const recentLog = await executeGitLog(repo.localPath, { count: 5 });

      const protectedBranches = repositoryStore.listProtectedBranches(
        repositoryId,
        context.tenantId,
      );

      response.status(200).json({
        repository: repo,
        branch: gitStatus.branch,
        currentBranch: gitStatus.branch,
        ahead: gitStatus.ahead,
        behind: gitStatus.behind,
        clean: gitStatus.clean,
        entries: gitStatus.entries,
        branches,
        recentCommits: recentLog,
        protectedBranches,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      if (message.includes("not found")) {
        throw new AppError("Repository not found", "NOT_FOUND", 404);
      }
      throw new AppError(
        `Failed to get repository status: ${message}`,
        "SERVICE_UNAVAILABLE",
        503,
      );
    }
  } catch (error) {
    next(error);
  }
}
