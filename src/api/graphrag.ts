import type { NextFunction, Request, Response } from "express";
import { AppError } from "../errors/app-error.js";
import { executeGitStatus } from "../git/engine.js";
import { repositoryIndexer } from "../graph/repository-indexer.js";

export async function indexRepositoryHandler(
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

    const result = await repositoryIndexer.indexRepository(
      repoId,
      context.tenantId,
    );

    response.status(200).json({
      repositoryId: repoId,
      status: "indexed",
      result,
    });
  } catch (error) {
    next(error);
  }
}

export async function getGraphHandler(
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

    const repositoryId = request.params.repositoryId as string;
    const graph = await repositoryIndexer.getGraph(
      repositoryId,
      context.tenantId,
    );

    response.status(200).json(graph);
  } catch (error) {
    next(error);
  }
}

export async function searchCodeHandler(
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

    const query =
      typeof body.query === "string" && body.query.trim()
        ? body.query.trim()
        : (() => {
            throw new AppError("query is required", "VALIDATION_ERROR", 400);
          })();

    const graph = await repositoryIndexer.getGraph(repoId, context.tenantId);

    const matchingNodes = graph.nodes.filter(
      (n) =>
        n.name.toLowerCase().includes(query.toLowerCase()) ||
        n.kind.toLowerCase().includes(query.toLowerCase()),
    );

    const matchingSymbols = graph.symbols.filter(
      (s) =>
        s.name.toLowerCase().includes(query.toLowerCase()) ||
        s.filePath.toLowerCase().includes(query.toLowerCase()),
    );

    response.status(200).json({
      query,
      nodes: matchingNodes,
      symbols: matchingSymbols,
    });
  } catch (error) {
    next(error);
  }
}

export async function getSymbolsHandler(
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

    const graph = await repositoryIndexer.getGraph(repoId, context.tenantId);

    response.status(200).json(graph.symbols);
  } catch (error) {
    next(error);
  }
}

export async function getIndexStatusHandler(
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

    const repositoryId = request.params.repositoryId as string;
    let status;

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
