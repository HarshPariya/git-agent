import type { Request, Response, NextFunction } from "express";
import { repositoryStore } from "../../../repositories/repository-store.js";
import { AppError } from "../../../errors/app-error.js";

export async function addProtectedBranchHandler(
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

    const body =
      typeof request.body === "object" && request.body !== null
        ? (request.body as Record<string, unknown>)
        : {};

    const branchName =
      typeof body.branch === "string" && body.branch.trim()
        ? body.branch.trim()
        : (() => {
            throw new AppError(
              "Branch name is required",
              "VALIDATION_ERROR",
              400,
            );
          })();

    const requiredApprovals =
      typeof body.requiredApprovals === "number" && body.requiredApprovals >= 0
        ? body.requiredApprovals
        : 1;

    const allowedPushRoles =
      body.allowedPushRoles instanceof Array
        ? (body.allowedPushRoles as string[])
        : [];

    try {
      const branch = repositoryStore.addProtectedBranch(
        repositoryId,
        context.tenantId,
        branchName,
        {
          allowedPushRoles:
            allowedPushRoles.length > 0 ? allowedPushRoles : ["admin"],
          requiresReview: true,
          requiredApprovals,
          requiresStatusChecks: true,
          requiresLinearHistory: true,
          allowsForcePush: false,
          allowsDeletion: false,
        },
      );

      response.status(201).json({
        branch,
        message: "Protected branch rule added successfully",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      if (message.includes("not found")) {
        throw new AppError("Repository not found", "NOT_FOUND", 404);
      }
      if (message.includes("already exists")) {
        throw new AppError(
          `Branch ${branchName} is already protected`,
          "VALIDATION_ERROR",
          409,
        );
      }
      throw new AppError(
        `Failed to add protected branch: ${message}`,
        "INTERNAL_ERROR",
        500,
      );
    }
  } catch (error) {
    next(error);
  }
}
