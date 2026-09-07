import type { Request, Response, NextFunction } from "express";
import { repositoryStore } from "../../repositories/repository-store.js";
import { AppError } from "../../errors/app-error.js";
import { recordAuditEntry } from "../audit.js";

export async function disconnectRepositoryHandler(
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

    const repositoryId = request.params.id as string;

    try {
      const repository = await repositoryStore.disconnectRepository(
        repositoryId,
        context.tenantId,
      );

      recordAuditEntry({
        repositoryId,
        tenantId: context.tenantId,
        userId: context.userId,
        action: "repository:disconnect",
        category: "git_operation",
        details: "Repository disconnected",
        riskLevel: "medium",
      });

      response.status(200).json({
        repository,
        message: "Repository disconnected successfully",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      if (message.includes("not found")) {
        throw new AppError("Repository not found", "NOT_FOUND", 404);
      }
      throw new AppError(
        `Failed to disconnect repository: ${message}`,
        "INTERNAL_ERROR",
        500,
      );
    }
  } catch (error) {
    next(error);
  }
}
