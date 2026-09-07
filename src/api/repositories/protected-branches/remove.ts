import type { Request, Response, NextFunction } from "express";
import { repositoryStore } from "../../../repositories/repository-store.js";
import { AppError } from "../../../errors/app-error.js";

export async function removeProtectedBranchHandler(
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
    const branchName = request.params.branch as string;

    try {
      const success = repositoryStore.removeProtectedBranch(
        repositoryId,
        context.tenantId,
        branchName,
      );

      if (!success) {
        throw new AppError(
          `Protected branch ${branchName} not found`,
          "NOT_FOUND",
          404,
        );
      }

      response.status(200).json({
        message: `Protected branch ${branchName} removed successfully`,
      });
    } catch (err) {
      if (err instanceof AppError) throw err;
      const message = err instanceof Error ? err.message : "Unknown error";
      throw new AppError(
        `Failed to remove protected branch: ${message}`,
        "INTERNAL_ERROR",
        500,
      );
    }
  } catch (error) {
    next(error);
  }
}
