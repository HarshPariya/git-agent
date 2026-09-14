import type { Request, Response, NextFunction } from "express";
import { AppError } from "../../errors/app-error.js";
import { repositoryStore } from "../../repositories/repository-store.js";

const getTenantContext = (request: Request) => {
  const context = request.tenantContext;
  if (!context) throw new AppError("Tenant context is missing", "AUTHENTICATION_ERROR", 401);
  return context;
};

export const disconnectRepositoryHandler = async (
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const context = getTenantContext(request);
    const repositoryId = String(request.params.id || "").trim();
    if (!repositoryId) throw new AppError("Repository id is required", "VALIDATION_ERROR", 400);
    await repositoryStore.disconnectRepository(repositoryId, context.tenantId);
    response.status(200).json({ success: true });
  } catch (error) {
    next(error);
  }
};
