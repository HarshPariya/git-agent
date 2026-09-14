import type { Request, Response, NextFunction } from "express";
import { AppError } from "../../../errors/app-error.js";
import { repositoryStore } from "../../../repositories/repository-store.js";

const getTenantContext = (request: Request) => {
  const context = request.tenantContext;
  if (!context) throw new AppError("Tenant context is missing", "AUTHENTICATION_ERROR", 401);
  return context;
};

export const listProtectedBranchesHandler = (request: Request, response: Response, next: NextFunction): void => {
  try {
    const context = getTenantContext(request);
    const branches = repositoryStore.listProtectedBranches(request.params.id as string, context.tenantId);
    response.status(200).json({ protectedBranches: branches });
  } catch (error) {
    next(error);
  }
};
