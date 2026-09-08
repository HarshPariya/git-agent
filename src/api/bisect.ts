import type { NextFunction, Request, Response } from "express";
import { AppError } from "../errors/app-error.js";
import { executeGitStatus } from "../git/engine.js";
import { runBisect, detectRegression } from "../git/bisect.js";
import type { Repository } from "../types/git.js";

const getCtx = (request: Request) => request.tenantContext ?? (() => { throw new AppError("Tenant context is missing", "AUTHENTICATION_ERROR", 401); })();
const getBody = (request: Request) => (typeof request.body === "object" && request.body !== null ? (request.body as Record<string, unknown>) : {});
const requireRepoId = (body: Record<string, unknown>) => typeof body.repositoryId === "string" && body.repositoryId.trim() ? body.repositoryId.trim() : (() => { throw new AppError("repositoryId is required", "VALIDATION_ERROR", 400); })();
const optionalStr = (body: Record<string, unknown>, key: string, fallback: string) => typeof body[key] === "string" && (body[key] as string).trim() ? (body[key] as string).trim() : fallback;

const makeRepo = (id: string, tenantId: string, userId: string): Repository => ({ id, tenantId, userId, name: id, url: "", localPath: "", defaultBranch: "main", currentBranch: "main", status: "connected", lastSyncAt: new Date().toISOString(), createdAt: new Date().toISOString(), protectedBranches: [] });

export async function runBisectHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = getCtx(request); const body = getBody(request);
    const repoId = requireRepoId(body); const startRef = optionalStr(body, "startRef", "HEAD~10"); const endRef = optionalStr(body, "endRef", "HEAD");
    const testCommand = typeof body.testCommand === "string" && body.testCommand.trim() ? body.testCommand.trim() : (() => { throw new AppError("testCommand is required", "VALIDATION_ERROR", 400); })();
    await executeGitStatus(repoId);
    const result = await runBisect(makeRepo(repoId, ctx.tenantId, ctx.userId), startRef, endRef, testCommand);
    response.status(200).json(result);
  } catch (error) { next(error); }
}

export async function detectRegressionHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = getCtx(request); const body = getBody(request);
    const repoId = requireRepoId(body); const startRef = optionalStr(body, "startRef", "HEAD~10"); const endRef = optionalStr(body, "endRef", "HEAD");
    await executeGitStatus(repoId);
    const result = await detectRegression(makeRepo(repoId, ctx.tenantId, ctx.userId), startRef, endRef);
    response.status(200).json(result);
  } catch (error) { next(error); }
}
