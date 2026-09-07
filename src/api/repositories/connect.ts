import type { Request, Response, NextFunction } from "express";
import { repositoryStore } from "../../repositories/repository-store.js";
import { AppError } from "../../errors/app-error.js";
import { validateGitUrl } from "../../git/engine.js";
import { recordAuditEntry } from "../audit.js";

export async function connectRepositoryHandler(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const context =
      request.tenantContext ??
      (() => {
        throw new AppError(
          "Tenant context is missing",
          "AUTHENTICATION_ERROR",
          401,
        );
      })();

    const body =
      typeof request.body === "object" && request.body !== null
        ? (request.body as Record<string, unknown>)
        : {};

    const name =
      typeof body.name === "string" && body.name.trim()
        ? body.name.trim()
        : (() => {
          throw new AppError(
            "Repository name is required",
            "VALIDATION_ERROR",
            400,
          );
        })();

    const localPath =
      typeof body.localPath === "string" && body.localPath.trim()
        ? body.localPath.trim()
        : undefined;
    const url =
      typeof body.url === "string" && body.url.trim()
        ? body.url.trim()
        : localPath
          ? `file://${localPath}`
          : (() => {
            throw new AppError(
              "Repository URL is required",
              "VALIDATION_ERROR",
              400,
            );
          })();

    if (!localPath && !validateGitUrl(url)) {
      throw new AppError("Invalid git URL format", "VALIDATION_ERROR", 400);
    }

    try {
      const repository = await repositoryStore.connectRepository({
        tenantId: context.tenantId,
        userId: context.userId,
        name,
        url,
        ...(localPath !== undefined && { localPath }),
      });

      recordAuditEntry({
        repositoryId: repository.id,
        tenantId: context.tenantId,
        userId: context.userId,
        action: "repository:connect",
        category: "git_operation",
        details: `Repository connected: ${name}`,
        riskLevel: "low",
      });

      response.status(201).json({
        repository,
        message: "Repository connected successfully",
      });
    } catch (err) {
      throw new AppError(
        `Failed to connect repository: ${err instanceof Error ? err.message : "Unknown error"}`,
        "SERVICE_UNAVAILABLE",
        503,
      );
    }
  } catch (error) {
    next(error);
  }
}
