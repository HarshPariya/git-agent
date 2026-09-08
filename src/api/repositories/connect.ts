import type { Request, Response, NextFunction } from "express";
import { AppError } from "../../errors/app-error.js";
import { repositoryStore } from "../../repositories/repository-store.js";

export const connectRepositoryHandler = async (request: Request, response: Response, next: NextFunction) => {
  try {
    const context = request.tenantContext ?? (() => { throw new AppError("Tenant context is missing", "AUTHENTICATION_ERROR", 401); })();
    const { url, name, localPath } = (request.body || {}) as Record<string, unknown>;
    if (!name || typeof name !== "string") throw new AppError("Repository name is required", "VALIDATION_ERROR", 400);
    const validUrl = typeof url === "string" && url.trim() ? url.trim() : undefined;
    const validLocalPath = typeof localPath === "string" && localPath.trim() ? localPath.trim() : undefined;
    if (!validUrl && !validLocalPath) throw new AppError("Repository URL or local path is required", "VALIDATION_ERROR", 400);
    const repo = await repositoryStore.connectRepository({
      tenantId: context.tenantId, userId: context.userId, name: name.trim(), url: validUrl, localPath: validLocalPath,
    });
    response.status(201).json({ repository: repo });
  } catch (error) { next(error); }
};
