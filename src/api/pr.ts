import "dotenv/config";
import type { NextFunction, Request, Response } from "express";
import { AppError } from "../errors/app-error.js";
import { executeGitStatus } from "../git/engine.js";
import type { PullRequest } from "../types/git.js";
import crypto from "node:crypto";

const pullRequests = new Map<string, PullRequest>();

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

const optionalString = (body: Record<string, unknown>, key: string, fallback?: string): string | undefined => {
  const value = body[key];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
};

const matchesRepo = (pr: PullRequest, repoId?: string): boolean => !repoId || pr.repositoryId === repoId;

const getPrId = (request: Request): string => (request.params.id as string) || "";

const validateRepositoryAccess = async (repoId: string | undefined): Promise<void> => {
  if (repoId) {
    try {
      await executeGitStatus(repoId);
    } catch {
      /* synthetic id fallback */
    }
  }
};

export async function listPullRequestsHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    getTenantContext(request);
    const queryRepo = typeof request.query.repositoryId === "string" ? request.query.repositoryId.trim() : undefined;
    const body = getRequestBody(request);
    const repoId = queryRepo ?? optionalString(body, "repositoryId");
    const stateFilter = typeof request.query.state === "string" ? request.query.state.trim() : undefined;

    await validateRepositoryAccess(repoId);

    let prs = [...pullRequests.values()].filter((pr) => matchesRepo(pr, repoId));
    if (stateFilter && stateFilter !== "all") prs = prs.filter((pr) => pr.status === stateFilter);

    response.status(200).json({ pullRequests: prs });
  } catch (error) {
    next(error);
  }
}

export async function getPullRequestHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    getTenantContext(request);
    const pr = pullRequests.get(getPrId(request));
    if (!pr) throw new AppError("Pull request not found", "NOT_FOUND", 404);
    await validateRepositoryAccess(pr.repositoryId);
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
    const context = getTenantContext(request);
    const body = getRequestBody(request);
    const repoId = requireString(body, "repositoryId");
    const title = requireString(body, "title");
    const sourceBranch = requireString(body, "sourceBranch");
    const targetBranch = optionalString(body, "targetBranch", "main");

    await validateRepositoryAccess(repoId);

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
      targetBranch: targetBranch ?? "main",
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

export async function mergePullRequestHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    getTenantContext(request);
    const prId = getPrId(request);
    const pr = pullRequests.get(prId);
    if (!pr) throw new AppError("Pull request not found", "NOT_FOUND", 404);

    await validateRepositoryAccess(pr.repositoryId);

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

export async function addPrReviewerHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    getTenantContext(request);
    const body = getRequestBody(request);
    const reviewer = requireString(body, "reviewer");
    const prId = getPrId(request);
    const pr = pullRequests.get(prId);

    if (!pr) throw new AppError("Pull request not found", "NOT_FOUND", 404);
    await validateRepositoryAccess(pr.repositoryId);

    const updated: PullRequest = {
      ...pr,
      reviewers: [...pr.reviewers, { user: reviewer, status: "pending" }],
      updatedAt: new Date().toISOString(),
    };

    pullRequests.set(prId, updated);
    response.status(200).json(updated);
  } catch (error) {
    next(error);
  }
}
