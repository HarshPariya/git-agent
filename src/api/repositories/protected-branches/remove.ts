import type { Request, Response, NextFunction } from "express";
import { AppError } from "../../../errors/app-error.js";
import { repositoryStore } from "../../../repositories/repository-store.js";

export const removeProtectedBranchHandler = async (request: Request, response: Response, next: NextFunction) => {
  try {
    const context = request.tenantContext ?? (() => { throw new AppError("Tenant context is missing", "AUTHENTICATION_ERROR", 401); })();
    const { branchName } = (request.body || {}) as Record<string, unknown>;
    if (!branchName || typeof branchName !== "string") throw new AppError("Branch name is required", "VALIDATION_ERROR", 400);
    repositoryStore.removeProtectedBranch(request.params.id as string, context.tenantId, branchName);
    response.status(200).json({ success: true });
  } catch (error) { next(error); }
};
