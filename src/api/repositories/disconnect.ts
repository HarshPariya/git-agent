import type { Request, Response, NextFunction } from "express";
import { AppError } from "../../errors/app-error.js";
import { repositoryStore } from "../../repositories/repository-store.js";

export const disconnectRepositoryHandler = async (request: Request, response: Response, next: NextFunction) => {
  try {
    const context = request.tenantContext ?? (() => { throw new AppError("Tenant context is missing", "AUTHENTICATION_ERROR", 401); })();
    const { repositoryId } = (request.body || {}) as Record<string, unknown>;
    if (!repositoryId || typeof repositoryId !== "string") throw new AppError("Repository ID is required", "VALIDATION_ERROR", 400);
    await repositoryStore.disconnectRepository(repositoryId, context.tenantId);
    response.status(200).json({ success: true });
  } catch (error) { next(error); }
};
