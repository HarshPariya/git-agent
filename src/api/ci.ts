import "dotenv/config";
import type { NextFunction, Request, Response } from "express";
import { AppError } from "../errors/app-error.js";
import { executeGitStatus } from "../git/engine.js";
import type { CiBuild } from "../types/git.js";
import crypto from "node:crypto";

const ciBuilds = new Map<string, CiBuild>();

export async function listCiBuildsHandler(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!request.tenantContext) {
      throw new AppError(
        "Tenant context is missing",
        "AUTHENTICATION_ERROR",
        401,
      );
    }

    const body =
      typeof request.body === "object" && request.body !== null
        ? (request.body as Record<string, unknown>)
        : {};

    const repoId =
      typeof body.repositoryId === "string" && body.repositoryId.trim()
        ? body.repositoryId.trim()
        : undefined;

    if (repoId) {
      try {
        await executeGitStatus(repoId);
      } catch {
        // Repository not accessible; continue without failing
      }
    }

    const builds = [...ciBuilds.values()].filter(
      (b) => !repoId || b.repositoryId === repoId,
    );

    response.status(200).json({ builds });
  } catch (error) {
    next(error);
  }
}

export async function getCiBuildHandler(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = request.params.id as string;
    const build = ciBuilds.get(id);

    if (!build) {
      throw new AppError("CI build not found", "NOT_FOUND", 404);
    }

    if (build.repositoryId) {
      try {
        await executeGitStatus(build.repositoryId);
      } catch {
        // Repository not accessible; continue without failing
      }
    }

    response.status(200).json(build);
  } catch (error) {
    next(error);
  }
}

export async function triggerCiBuildHandler(
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

    try {
      await executeGitStatus(repoId);
    } catch {
      throw new AppError("Repository not accessible", "VALIDATION_ERROR", 400);
    }

    const branch =
      typeof body.branch === "string" && body.branch.trim()
        ? body.branch.trim()
        : undefined;

    const buildId = `build-${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();

    const build: CiBuild = {
      id: buildId,
      repositoryId: repoId,
      branch: branch || "",
      commitHash: "",
      status: "queued",
      triggeredBy: context.userId,
      triggerType: (typeof body.triggerType === "string"
        ? body.triggerType
        : "manual") as "push" | "pull_request" | "manual" | "schedule",
      startedAt: now,
      steps: [],
    };

    ciBuilds.set(buildId, {
      ...build,
      status: "running",
      startedAt: now,
      steps: [{ name: "checkout", status: "running" }],
    });

    response.status(201).json({
      id: buildId,
      status: "queued",
      message: "Build triggered successfully",
    });
  } catch (error) {
    next(error);
  }
}

export async function getCiBuildLogsHandler(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!request.tenantContext) {
      throw new AppError(
        "Tenant context is missing",
        "AUTHENTICATION_ERROR",
        401,
      );
    }

    const id = request.params.id as string;
    const build = ciBuilds.get(id);

    if (!build) {
      throw new AppError("CI build not found", "NOT_FOUND", 404);
    }

    if (build.repositoryId) {
      try {
        await executeGitStatus(build.repositoryId);
      } catch {
        // Repository not accessible; continue without failing
      }
    }

    response.status(200).json({
      buildId: build.id,
      logs: build.steps.map((s) => s.output ?? "").join("\n"),
      steps: build.steps,
    });
  } catch (error) {
    next(error);
  }
}
