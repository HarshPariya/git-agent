import type { Request, Response, NextFunction } from "express";
import { AppError } from "../../errors/app-error.js";
import { repositoryStore } from "../../repositories/repository-store.js";

const getTenantContext = (request: Request) => {
  const context = request.tenantContext;
  if (!context) throw new AppError("Tenant context is missing", "AUTHENTICATION_ERROR", 401);
  return context;
};

export const getRepositoryHandler = (request: Request, response: Response, next: NextFunction): void => {
  try {
    const context = getTenantContext(request);
    const repo = repositoryStore.getRepository(request.params.id as string, context.tenantId);
    if (!repo) throw new AppError("Repository not found", "NOT_FOUND", 404);
    response.status(200).json({ repository: repo });
  } catch (error) {
    next(error);
  }
};
