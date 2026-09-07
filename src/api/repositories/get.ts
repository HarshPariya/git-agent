import type { Request, Response, NextFunction } from "express";
import { repositoryStore } from "../../repositories/repository-store.js";
import { AppError } from "../../errors/app-error.js";

export async function getRepositoryHandler(
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
    const repo = repositoryStore.getRepository(repositoryId, context.tenantId);

    if (!repo) {
      throw new AppError("Repository not found", "NOT_FOUND", 404);
    }

    response.status(200).json(repo);
  } catch (error) {
    next(error);
  }
}
