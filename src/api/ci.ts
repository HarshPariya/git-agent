import "dotenv/config";
import type { NextFunction, Request, Response } from "express";
import { AppError } from "../errors/app-error.js";
import { executeGitStatus } from "../git/engine.js";
import type { CiBuild } from "../types/git.js";
import crypto from "node:crypto";

const ciBuilds = new Map<string, CiBuild>();

const getTenantContext = (request: Request) => {
  const context = request.tenantContext;
  if (!context) throw new AppError("Tenant context is missing", "AUTHENTICATION_ERROR", 401);
  return context;
};

const getRequestBody = (request: Request): Record<string, unknown> =>
  typeof request.body === "object" && request.body !== null ? (request.body as Record<string, unknown>) : {};

const optionalString = (body: Record<string, unknown>, key: string): string | undefined => {
  const value = body[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
};

const requireString = (body: Record<string, unknown>, key: string): string => {
  const value = optionalString(body, key);
  if (!value) throw new AppError(`${key} is required`, "VALIDATION_ERROR", 400);
  return value;
};

const tryAccessRepository = async (repoId: string | undefined): Promise<void> => {
  if (repoId) {
    try {
      await executeGitStatus(repoId);
    } catch {
      /* not accessible */
    }
  }
};

const validateRepositoryAccess = async (repoId: string): Promise<void> => {
  try {
    await executeGitStatus(repoId);
  } catch {
    throw new AppError("Repository not accessible", "VALIDATION_ERROR", 400);
  }
};

const isValidTriggerType = (value: unknown): value is "push" | "pull_request" | "manual" | "schedule" =>
  value === "push" || value === "pull_request" || value === "manual" || value === "schedule";

export async function listCiBuildsHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    getTenantContext(request);
    const query = request.query as Record<string, unknown>;
    const repoId =
      typeof query.repositoryId === "string" && query.repositoryId.trim()
        ? query.repositoryId.trim()
        : optionalString(getRequestBody(request), "repositoryId");

    await tryAccessRepository(repoId);

    const builds = [...ciBuilds.values()].filter((b) => !repoId || b.repositoryId === repoId);
    response.status(200).json({ builds });
  } catch (error) {
    next(error);
  }
}

export async function getCiBuildHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const build = ciBuilds.get(request.params.id as string);
    if (!build) throw new AppError("CI build not found", "NOT_FOUND", 404);

    await tryAccessRepository(build.repositoryId);
    response.status(200).json(build);
  } catch (error) {
    next(error);
  }
}

export async function triggerCiBuildHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const context = getTenantContext(request);
    const body = getRequestBody(request);
    const repoId = requireString(body, "repositoryId");
    const branch = optionalString(body, "branch") ?? "";
    const triggerType = isValidTriggerType(body.triggerType) ? body.triggerType : "manual";

    await validateRepositoryAccess(repoId);

    const buildId = `build-${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();

    const build: CiBuild = {
      id: buildId,
      repositoryId: repoId,
      branch,
      commitHash: "",
      status: "queued",
      triggeredBy: context.userId,
      triggerType,
      startedAt: now,
      steps: [],
    };

    ciBuilds.set(buildId, {
      ...build,
      status: "running",
      startedAt: now,
      steps: [{ name: "checkout", status: "running" }],
    });
    response.status(201).json({ id: buildId, status: "queued", message: "Build triggered successfully" });
  } catch (error) {
    next(error);
  }
}

export async function getCiBuildLogsHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    getTenantContext(request);
    const build = ciBuilds.get(request.params.id as string);
    if (!build) throw new AppError("CI build not found", "NOT_FOUND", 404);

    await tryAccessRepository(build.repositoryId);

    response.status(200).json({
      buildId: build.id,
      logs: build.steps.map((s) => s.output ?? "").join("\n"),
      steps: build.steps,
    });
  } catch (error) {
    next(error);
  }
}
