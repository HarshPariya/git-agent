import type { Repository, RepositoryIndexStatus, CodeSymbol, CodeGraphNode, CodeGraphEdge } from "../types/git.js";
import { AppError } from "../errors/app-error.js";
import { graphBuilder } from "./graph-builder.js";
import { executeGitStatus } from "../git/engine.js";

const indexStatuses = new Map<string, RepositoryIndexStatus>();

export interface IndexingResult {
  readonly repositoryId: string;
  readonly status: "indexed" | "failed";
  readonly totalFiles: number;
  readonly totalSymbols: number;
  readonly totalChunks: number;
  readonly durationMs: number;
  readonly error?: string | undefined;
}

const ensureConnected = async (repositoryId: string, tenantId: string): Promise<Repository> => {
  try {
    const { branch } = await executeGitStatus(repositoryId);
    return {
      id: repositoryId,
      tenantId,
      userId: "",
      name: repositoryId,
      url: "",
      localPath: "",
      defaultBranch: "main",
      currentBranch: branch,
      status: "connected",
      lastSyncAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      protectedBranches: [],
    };
  } catch (err) {
    throw new AppError(
      `Cannot index repository: ${err instanceof Error ? err.message : "Unknown error"}`,
      "VALIDATION_ERROR",
      400,
    );
  }
};

const updateIndexStatus = (repositoryId: string, status: Partial<RepositoryIndexStatus>): void => {
  const existing = indexStatuses.get(repositoryId);
  indexStatuses.set(repositoryId, {
    repositoryId,
    status: existing?.status ?? "indexing",
    progress: existing?.progress ?? 0,
    totalFiles: existing?.totalFiles ?? 0,
    totalSymbols: existing?.totalSymbols ?? 0,
    totalChunks: existing?.totalChunks ?? 0,
    ...status,
  });
};

export class RepositoryIndexer {
  async indexRepository(repositoryId: string, tenantId: string): Promise<IndexingResult> {
    const startTime = Date.now();
    const repo = await ensureConnected(repositoryId, tenantId);

    if (repo.status !== "connected") {
      throw new AppError("Repository must be connected before indexing", "SERVICE_UNAVAILABLE", 409);
    }

    updateIndexStatus(repositoryId, { status: "indexing", progress: 0 });

    try {
      const { nodes, symbols } = await graphBuilder.indexRepository(repo);
      const totalFiles = nodes.length;
      const totalSymbols = symbols.length;
      const totalChunks = totalFiles;

      updateIndexStatus(repositoryId, {
        status: "indexed",
        progress: 100,
        totalFiles,
        totalSymbols,
        totalChunks,
      });

      return {
        repositoryId,
        status: "indexed",
        totalFiles,
        totalSymbols,
        totalChunks,
        durationMs: Date.now() - startTime,
      };
    } catch (err) {
      updateIndexStatus(repositoryId, { status: "failed" });
      return {
        repositoryId,
        status: "failed",
        totalFiles: 0,
        totalSymbols: 0,
        totalChunks: 0,
        durationMs: Date.now() - startTime,
        error: err instanceof Error ? err.message : "Unknown error",
      };
    }
  }

  async getGraph(
    repositoryId: string,
    tenantId: string,
  ): Promise<{
    readonly nodes: readonly CodeGraphNode[];
    readonly edges: readonly CodeGraphEdge[];
    readonly symbols: readonly CodeSymbol[];
  }> {
    const repo = await ensureConnected(repositoryId, tenantId);
    return graphBuilder.indexRepository(repo);
  }

  getIndexStatus(repositoryId: string): RepositoryIndexStatus | undefined {
    return indexStatuses.get(repositoryId);
  }
}

export const repositoryIndexer = new RepositoryIndexer();
