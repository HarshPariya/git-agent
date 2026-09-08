import type { Request, Response, NextFunction } from "express";
import { AppError } from "../../../errors/app-error.js";
import { repositoryStore } from "../../../repositories/repository-store.js";

const getTenantContext = (request: Request) => {
  const context = request.tenantContext;
  if (!context) throw new AppError("Tenant context is missing", "AUTHENTICATION_ERROR", 401);
  return context;
};

const requireString = (body: unknown, key: string): string => {
  const value = (body as Record<string, unknown>)?.[key];
  if (typeof value !== "string" || !value.trim()) throw new AppError(`${key} is required`, "VALIDATION_ERROR", 400);
  return value.trim();
};

export const removeProtectedBranchHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const context = getTenantContext(request);
    const repositoryId = request.params.id as string;
    const branchName = requireString(request.body, "branchName");
    repositoryStore.removeProtectedBranch(repositoryId, context.tenantId, branchName);
    response.status(200).json({ success: true });
  } catch (error) {
    next(error);
  }
};
