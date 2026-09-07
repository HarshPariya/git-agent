import type {
  Repository,
  RepositoryIndexStatus,
  CodeSymbol,
  CodeGraphNode,
  CodeGraphEdge,
} from "../types/git.js";
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

function ensureConnected(
  repositoryId: string,
  tenantId: string,
): Promise<Repository> {
  return executeGitStatus(repositoryId).then(
    (status) =>
      ({
        id: repositoryId,
        tenantId,
        userId: "",
        name: repositoryId,
        url: "",
        localPath: "",
        defaultBranch: "main",
        currentBranch: status.branch,
        status: "connected" as const,
        lastSyncAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        protectedBranches: [],
      }) satisfies Repository,
  );
}

export class RepositoryIndexer {
  async indexRepository(
    repositoryId: string,
    tenantId: string,
  ): Promise<IndexingResult> {
    const startTime = Date.now();

    let repo: Repository;
    try {
      repo = await ensureConnected(repositoryId, tenantId);
    } catch (err) {
      throw new AppError(
        `Cannot index repository: ${err instanceof Error ? err.message : "Unknown error"}`,
        "VALIDATION_ERROR",
        400,
      );
    }

    if (repo.status !== "connected") {
      throw new AppError(
        "Repository must be connected before indexing",
        "SERVICE_UNAVAILABLE",
        409,
      );
    }

    indexStatuses.set(repositoryId, {
      repositoryId,
      status: "indexing",
      progress: 0,
      totalFiles: 0,
      totalSymbols: 0,
      totalChunks: 0,
    });

    try {
      const result = await graphBuilder.indexRepository(repo);
      const totalFiles = result.nodes.length;
      const totalSymbols = result.symbols.length;
      const totalChunks = totalFiles;

      indexStatuses.set(repositoryId, {
        repositoryId,
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
      const existing = indexStatuses.get(repositoryId);
      const progress = existing?.progress ?? 0;
      indexStatuses.set(repositoryId, {
        repositoryId,
        status: "failed",
        progress,
        totalFiles: 0,
        totalSymbols: 0,
        totalChunks: 0,
      });

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
