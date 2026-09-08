import type { Request, Response, NextFunction } from "express";
import { AppError } from "../../errors/app-error.js";
import { repositoryStore } from "../../repositories/repository-store.js";

export const getRepositoryHandler = async (request: Request, response: Response, next: NextFunction) => {
  try {
    const context = request.tenantContext ?? (() => { throw new AppError("Tenant context is missing", "AUTHENTICATION_ERROR", 401); })();
    const repo = repositoryStore.getRepository(request.params.id as string, context.tenantId);
    if (!repo) throw new AppError("Repository not found", "NOT_FOUND", 404);
    response.status(200).json({ repository: repo });
  } catch (error) { next(error); }
};
