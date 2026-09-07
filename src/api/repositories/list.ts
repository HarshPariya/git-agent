import type { Request, Response, NextFunction } from "express";
import { repositoryStore } from "../../repositories/repository-store.js";
import { AppError } from "../../errors/app-error.js";

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

    response.status(200).json({
      repositories,
      total: repositories.length,
    });
  } catch (error) {
    next(error);
  }
}
