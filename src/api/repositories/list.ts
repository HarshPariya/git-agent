import fs from "node:fs";
import type { Request, Response, NextFunction } from "express";
import { repositoryStore } from "../../repositories/repository-store.js";
import { AppError } from "../../errors/app-error.js";
import { executeGitStatus } from "../../git/engine.js";

export async function listRepositoriesHandler(
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

    const repositories = repositoryStore.listRepositories(context.tenantId);

    // Refresh current branch on disk for active repositories
    for (const repo of repositories) {
      if (repo.localPath && fs.existsSync(repo.localPath)) {
        try {
          const status = await executeGitStatus(repo.localPath);
          (repo as any).currentBranch = status.branch;
          if (repo.defaultBranch === "feature/agent-llm" || !repo.defaultBranch) {
            (repo as any).defaultBranch = "development";
          }
        } catch {
          // Keep current values on git status failure
        }
      }
    }

    response.status(200).json({
      repositories,
      total: repositories.length,
    });
  } catch (error) {
    next(error);
  }
}
