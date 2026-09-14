import type { NextFunction, Request, Response } from "express";
import { AppError } from "../errors/app-error.js";
import { executeGitStatus } from "../git/engine.js";
import { repositoryIndexer } from "../graph/repository-indexer.js";

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

const validateRepositoryAccess = async (repoId: string): Promise<void> => {
  try {
    await executeGitStatus(repoId);
  } catch {
    throw new AppError("Repository not accessible", "VALIDATION_ERROR", 400);
  }
};

export async function indexRepositoryHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const context = getTenantContext(request);
    const body = getRequestBody(request);
    const repoId = requireString(body, "repositoryId");
    await validateRepositoryAccess(repoId);
    const result = await repositoryIndexer.indexRepository(repoId, context.tenantId);
    response.status(200).json({ repositoryId: repoId, status: "indexed", result });
  } catch (error) {
    next(error);
  }
}

export async function getGraphHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const context = getTenantContext(request);
    const repositoryId = request.params.repositoryId as string;
    const graph = await repositoryIndexer.getGraph(repositoryId, context.tenantId);
    response.json(graph);
  } catch (error) {
    next(error);
  }
}

export async function searchCodeHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const context = getTenantContext(request);
    const body = getRequestBody(request);
    const repoId = requireString(body, "repositoryId");
    const query = requireString(body, "query");
    await validateRepositoryAccess(repoId);

    const graph = await repositoryIndexer.getGraph(repoId, context.tenantId);
    const lq = query.toLowerCase();

    response.status(200).json({
      query,
      nodes: graph.nodes.filter((n) => n.name.toLowerCase().includes(lq) || n.kind.toLowerCase().includes(lq)),
      symbols: graph.symbols.filter((s) => s.name.toLowerCase().includes(lq) || s.filePath.toLowerCase().includes(lq)),
    });
  } catch (error) {
    next(error);
  }
}

export async function getSymbolsHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const context = getTenantContext(request);
    const body = getRequestBody(request);
    const repoId = requireString(body, "repositoryId");
    await validateRepositoryAccess(repoId);

    const graph = await repositoryIndexer.getGraph(repoId, context.tenantId);
    response.status(200).json(graph.symbols);
  } catch (error) {
    next(error);
  }
}

export async function getIndexStatusHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    getTenantContext(request);
    const repositoryId = request.params.repositoryId as string;
    let status: { repositoryId: string; status: string };

    try {
      await executeGitStatus(repositoryId);
      status = { repositoryId, status: "ok" };
    } catch {
      status = { repositoryId, status: "not_connected" };
    }

    response.status(200).json(status);
  } catch (error) {
    next(error);
  }
}
