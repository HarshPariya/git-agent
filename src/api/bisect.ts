import type { NextFunction, Request, Response } from "express";
import { AppError } from "../errors/app-error.js";
import { executeGitStatus } from "../git/engine.js";
import { runBisect, detectRegression } from "../git/bisect.js";
import type { Repository } from "../types/git.js";

export async function runBisectHandler(
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

    const repoId =
      typeof body.repositoryId === "string" && body.repositoryId.trim()
        ? body.repositoryId.trim()
        : (() => {
            throw new AppError(
              "repositoryId is required",
              "VALIDATION_ERROR",
              400,
            );
          })();

    const startRef =
      typeof body.startRef === "string" && body.startRef.trim()
        ? body.startRef.trim()
        : "HEAD~10";

    const endRef =
      typeof body.endRef === "string" && body.endRef.trim()
        ? body.endRef.trim()
        : "HEAD";

    const testCommand =
      typeof body.testCommand === "string" && body.testCommand.trim()
        ? body.testCommand.trim()
        : (() => {
            throw new AppError(
              "testCommand is required",
              "VALIDATION_ERROR",
              400,
            );
          })();

    await executeGitStatus(repoId);

    const repo: Repository = {
      id: repoId,
      tenantId: context.tenantId,
      userId: context.userId,
      name: repoId,
      url: "",
      localPath: "",
      defaultBranch: "main",
      currentBranch: "main",
      status: "connected",
      lastSyncAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      protectedBranches: [],
    };

    const result = await runBisect(repo, startRef, endRef, testCommand);

    response.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function detectRegressionHandler(
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

    const repoId =
      typeof body.repositoryId === "string" && body.repositoryId.trim()
        ? body.repositoryId.trim()
        : (() => {
            throw new AppError(
              "repositoryId is required",
              "VALIDATION_ERROR",
              400,
            );
          })();

    const startRef =
      typeof body.startRef === "string" && body.startRef.trim()
        ? body.startRef.trim()
        : "HEAD~10";

    const endRef =
      typeof body.endRef === "string" && body.endRef.trim()
        ? body.endRef.trim()
        : "HEAD";

    await executeGitStatus(repoId);

    const repo: Repository = {
      id: repoId,
      tenantId: context.tenantId,
      userId: context.userId,
      name: repoId,
      url: "",
      localPath: "",
      defaultBranch: "main",
      currentBranch: "main",
      status: "connected",
      lastSyncAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      protectedBranches: [],
    };

    const result = await detectRegression(repo, startRef, endRef);

    response.status(200).json(result);
  } catch (error) {
    next(error);
  }
}
