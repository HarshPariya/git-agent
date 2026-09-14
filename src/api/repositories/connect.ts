import type { Request, Response, NextFunction } from "express";
import { AppError } from "../../errors/app-error.js";
import { repositoryStore } from "../../repositories/repository-store.js";

const getTenantContext = (request: Request) => {
  const context = request.tenantContext;
  if (!context) throw new AppError("Tenant context is missing", "AUTHENTICATION_ERROR", 401);
  return context;
};

const getRequestBody = (request: Request): Record<string, unknown> =>
  typeof request.body === "object" && request.body !== null ? request.body as Record<string, unknown> : {};

const optionalString = (body: Record<string, unknown>, key: string): string | undefined => {
  const value = body[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
};

export const connectRepositoryHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const context = getTenantContext(request);
    const body = getRequestBody(request);
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const url = optionalString(body, "url");
    const localPath = optionalString(body, "localPath");

    if (!name) throw new AppError("Repository name is required", "VALIDATION_ERROR", 400);
    if (!url && !localPath) throw new AppError("Repository URL or local path is required", "VALIDATION_ERROR", 400);

    const repo = await repositoryStore.connectRepository({
      tenantId: context.tenantId,
      userId: context.userId,
      name,
      url,
      localPath,
    });

    response.status(201).json({ repository: repo });
  } catch (error) {
    next(error);
  }
};
