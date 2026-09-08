import type { Request, Response, NextFunction } from "express";
import { AppError } from "../../../errors/app-error.js";
import { repositoryStore } from "../../../repositories/repository-store.js";

export const listProtectedBranchesHandler = async (request: Request, response: Response, next: NextFunction) => {
  try {
    const context = request.tenantContext ?? (() => { throw new AppError("Tenant context is missing", "AUTHENTICATION_ERROR", 401); })();
    const branches = repositoryStore.listProtectedBranches(request.params.id as string, context.tenantId);
    response.status(200).json({ protectedBranches: branches });
  } catch (error) { next(error); }
};
