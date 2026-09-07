import type { Request, Response, NextFunction } from "express";
import { repositoryStore } from "../../repositories/repository-store.js";
import { AppError } from "../../errors/app-error.js";
import { recordAuditEntry } from "../audit.js";

export async function syncRepositoryHandler(
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
      const result = await repositoryStore.syncRepository(
        repositoryId,
        context.tenantId,
      );

      recordAuditEntry({
        repositoryId,
        tenantId: context.tenantId,
        userId: context.userId,
        action: "repository:sync",
        category: "git_operation",
        details: `Synced repository. Ahead: ${result.ahead}, Behind: ${result.behind}`,
        riskLevel: "low",
      });

      response.status(200).json({
        repository: repositoryStore.getRepository(
          repositoryId,
          context.tenantId,
        ),
        syncResult: result,
        message: "Repository synced successfully",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      if (message.includes("not found")) {
        throw new AppError("Repository not found", "NOT_FOUND", 404);
      }
      throw new AppError(
        `Failed to sync repository: ${message}`,
        "SERVICE_UNAVAILABLE",
        503,
      );
    }
  } catch (error) {
    next(error);
  }
}
