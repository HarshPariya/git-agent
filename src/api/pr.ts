import "dotenv/config";
import type { NextFunction, Request, Response } from "express";
import { AppError } from "../errors/app-error.js";
import { executeGitStatus } from "../git/engine.js";
import type { PullRequest, PullRequestReviewer } from "../types/git.js";
import crypto from "node:crypto";

const pullRequests = new Map<string, PullRequest>();

export async function listPullRequestsHandler(
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
      await executeGitStatus(repoId);
    }

    const prs = [...pullRequests.values()].filter(
      (pr) => !repoId || pr.repositoryId === repoId,
    );

    response.status(200).json({ pullRequests: prs });
  } catch (error) {
    next(error);
  }
}

export async function getPullRequestHandler(
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

    const { id } = request.params;
    const prId = (id as string) || "";
    const pr = pullRequests.get(prId);

    if (!pr) {
      throw new AppError("Pull request not found", "NOT_FOUND", 404);
    }

    if (pr.repositoryId) {
      await executeGitStatus(pr.repositoryId);
    }

    response.status(200).json(pr);
  } catch (error) {
    next(error);
  }
}

export async function createPullRequestHandler(
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

    await executeGitStatus(repoId);

    const title =
      typeof body.title === "string" && body.title.trim()
        ? body.title.trim()
        : (() => {
            throw new AppError("title is required", "VALIDATION_ERROR", 400);
          })();

    const sourceBranch =
      typeof body.sourceBranch === "string" && body.sourceBranch.trim()
        ? body.sourceBranch.trim()
        : (() => {
            throw new AppError(
              "sourceBranch is required",
              "VALIDATION_ERROR",
              400,
            );
          })();

    const targetBranch =
      typeof body.targetBranch === "string" && body.targetBranch.trim()
        ? body.targetBranch.trim()
        : "main";

    const now = new Date().toISOString();
    const prId = `pr-${crypto.randomUUID().slice(0, 8)}`;

    const pr: PullRequest = {
      id: prId,
      repositoryId: repoId,
      number: Math.floor(Math.random() * 10000) + 1,
      title,
      description: typeof body.description === "string" ? body.description : "",
      status: "open",
      sourceBranch,
      targetBranch,
      author: context.userId,
      reviewers: [],
      baseSha: "",
      headSha: "",
      createdAt: now,
      updatedAt: now,
      labels: Array.isArray(body.labels) ? (body.labels as string[]) : [],
    };

    pullRequests.set(prId, pr);
    response.status(201).json(pr);
  } catch (error) {
    next(error);
  }
}

export async function mergePullRequestHandler(
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

    const { id } = request.params;
    const prId = (id as string) || "";
    const pr = pullRequests.get(prId);

    if (!pr) {
      throw new AppError("Pull request not found", "NOT_FOUND", 404);
    }

    if (pr.repositoryId) {
      await executeGitStatus(pr.repositoryId);
    }

    const merged: PullRequest = {
      ...pr,
      status: "merged",
      updatedAt: new Date().toISOString(),
      mergedAt: new Date().toISOString(),
    };

    pullRequests.set(prId, merged);
    response.status(200).json(merged);
  } catch (error) {
    next(error);
  }
}

export async function addPrReviewerHandler(
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

    const { id } = request.params;
    const prId = (id as string) || "";
    const body =
      typeof request.body === "object" && request.body !== null
        ? (request.body as Record<string, unknown>)
        : {};

    const reviewer =
      typeof body.reviewer === "string" && body.reviewer.trim()
        ? body.reviewer.trim()
        : (() => {
            throw new AppError("reviewer is required", "VALIDATION_ERROR", 400);
          })();

    const pr = pullRequests.get(prId);
    if (!pr) {
      throw new AppError("Pull request not found", "NOT_FOUND", 404);
    }

    if (pr.repositoryId) {
      await executeGitStatus(pr.repositoryId);
    }

    const newReviewer: PullRequestReviewer = {
      user: reviewer,
      status: "pending",
    };

    const updated: PullRequest = {
      ...pr,
      reviewers: [...pr.reviewers, newReviewer],
      updatedAt: new Date().toISOString(),
    };

    pullRequests.set(prId, updated);
    response.status(200).json(updated);
  } catch (error) {
    next(error);
  }
}
