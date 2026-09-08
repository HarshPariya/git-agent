import type { NextFunction, Request, Response } from "express";
import { AppError } from "../errors/app-error.js";
import { executeGitStatus } from "../git/engine.js";
import { repositoryIndexer } from "../graph/repository-indexer.js";

const getCtx = (request: Request) => request.tenantContext ?? (() => { throw new AppError("Tenant context is missing", "AUTHENTICATION_ERROR", 401); })();
const getBody = (request: Request) => (typeof request.body === "object" && request.body !== null ? (request.body as Record<string, unknown>) : {});
const requireRepoId = (body: Record<string, unknown>) => typeof body.repositoryId === "string" && body.repositoryId.trim() ? body.repositoryId.trim() : (() => { throw new AppError("repositoryId is required", "VALIDATION_ERROR", 400); })();
const checkRepo = async (repoId: string) => { try { await executeGitStatus(repoId); } catch { throw new AppError("Repository not accessible", "VALIDATION_ERROR", 400); } };

export async function indexRepositoryHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = getCtx(request); const body = getBody(request); const repoId = requireRepoId(body); await checkRepo(repoId);
    const result = await repositoryIndexer.indexRepository(repoId, ctx.tenantId);
    response.status(200).json({ repositoryId: repoId, status: "indexed", result });
  } catch (error) { next(error); }
}

export async function getGraphHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try { const ctx = getCtx(request); response.json(await repositoryIndexer.getGraph(request.params.repositoryId as string, ctx.tenantId)); } catch (error) { next(error); }
}

export async function searchCodeHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = getCtx(request); const body = getBody(request); const repoId = requireRepoId(body); await checkRepo(repoId);
    const query = typeof body.query === "string" && body.query.trim() ? body.query.trim() : (() => { throw new AppError("query is required", "VALIDATION_ERROR", 400); })();
    const graph = await repositoryIndexer.getGraph(repoId, ctx.tenantId);
    const lq = query.toLowerCase();
    response.status(200).json({ query, nodes: graph.nodes.filter((n) => n.name.toLowerCase().includes(lq) || n.kind.toLowerCase().includes(lq)), symbols: graph.symbols.filter((s) => s.name.toLowerCase().includes(lq) || s.filePath.toLowerCase().includes(lq)) });
  } catch (error) { next(error); }
}

export async function getSymbolsHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try { const ctx = getCtx(request); const body = getBody(request); const repoId = requireRepoId(body); await checkRepo(repoId); response.status(200).json((await repositoryIndexer.getGraph(repoId, ctx.tenantId)).symbols); } catch (error) { next(error); }
}

export async function getIndexStatusHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    if (!request.tenantContext) throw new AppError("Tenant context is missing", "AUTHENTICATION_ERROR", 401);
    const repositoryId = request.params.repositoryId as string; let status;
    try { await executeGitStatus(repositoryId); status = { repositoryId, status: "ok" }; } catch { status = { repositoryId, status: "not_connected" }; }
    response.status(200).json(status);
  } catch (error) { next(error); }
}
