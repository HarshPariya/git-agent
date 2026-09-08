import type { Request, Response, NextFunction } from "express";
import { AppError } from "../../errors/app-error.js";
import { repositoryStore } from "../../repositories/repository-store.js";

const getTenantContext = (request: Request) => {
  const context = request.tenantContext;
  if (!context) throw new AppError("Tenant context is missing", "AUTHENTICATION_ERROR", 401);
  return context;
};

export const listRepositoriesHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const context = getTenantContext(request);
    const repositories = repositoryStore.listRepositories(context.tenantId);
    response.status(200).json({ repositories });
  } catch (error) {
    next(error);
  }
};
