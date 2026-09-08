import type { Request, Response, NextFunction } from "express";
import { AppError } from "../../../errors/app-error.js";
import { repositoryStore } from "../../../repositories/repository-store.js";

export const addProtectedBranchHandler = async (request: Request, response: Response, next: NextFunction) => {
  try {
    const context = request.tenantContext ?? (() => { throw new AppError("Tenant context is missing", "AUTHENTICATION_ERROR", 401); })();
    const { id } = request.params;
    const { branchName } = (request.body || {}) as Record<string, unknown>;
    if (!branchName || typeof branchName !== "string") throw new AppError("Branch name is required", "VALIDATION_ERROR", 400);
    const branch = repositoryStore.addProtectedBranch(id as string, context.tenantId, branchName);
    response.status(201).json({ protectedBranch: branch });
  } catch (error) { next(error); }
};
