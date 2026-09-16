import type { NextFunction, Request, Response } from "express";
import { AppError } from "../errors/app-error.js";
import { executeGitStatus, getExecutionPath } from "../git/engine.js";
import { runBisect, detectRegression } from "../git/bisect.js";
import type { Repository } from "../types/git.js";

const getTenantContext = (request: Request) => {
  const context = request.tenantContext;
  if (!context) throw new AppError("Tenant context is missing", "AUTHENTICATION_ERROR", 401);
  return context;
};

const getRequestBody = (request: Request): Record<string, unknown> =>
  typeof request.body === "object" && request.body !== null ? (request.body as Record<string, unknown>) : {};

const requireString = (body: Record<string, unknown>, key: string): string => {
  const value = body[key];
  if (typeof value !== "string" || !value.trim()) throw new AppError(`${key} is required`, "VALIDATION_ERROR", 400);
  return value.trim();
};

const optionalString = (body: Record<string, unknown>, key: string, fallback: string): string => {
  const value = body[key];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
};

const makeRepository = (id: string, tenantId: string, userId: string): Repository => ({
  id,
  tenantId,
  userId,
  name: id,
  url: "",
  localPath: getExecutionPath(id),
  defaultBranch: "main",
  currentBranch: "main",
  status: "connected",
  lastSyncAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  protectedBranches: [],
});

export async function runBisectHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const context = getTenantContext(request);
    const body = getRequestBody(request);
    const repoId = requireString(body, "repositoryId");
    const testCommand = requireString(body, "testCommand");
    const startRef = optionalString(body, "startRef", "HEAD~10");
    const endRef = optionalString(body, "endRef", "HEAD");

    await executeGitStatus(repoId);
    const result = await runBisect(
      makeRepository(repoId, context.tenantId, context.userId),
      startRef,
      endRef,
      testCommand,
    );

    response.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function detectRegressionHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const context = getTenantContext(request);
    const body = getRequestBody(request);
    const repoId = requireString(body, "repositoryId");
    const startRef = optionalString(body, "startRef", "HEAD~10");
    const endRef = optionalString(body, "endRef", "HEAD");
    const testCommand = optionalString(body, "testCommand", "");

    await executeGitStatus(repoId);
    const result = await detectRegression(
      makeRepository(repoId, context.tenantId, context.userId),
      startRef,
      endRef,
      testCommand || undefined,
    );

    response.status(200).json(result);
  } catch (error) {
    next(error);
  }
}
