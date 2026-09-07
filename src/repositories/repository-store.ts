import fs from "node:fs";
import path from "node:path";

import type { Repository, ProtectedBranch, SyncResult } from "../types/git.js";
import { executeGitStatus, isProtectedBranch, registerRepositoryPath } from "../git/engine.js";
import { logger } from "../logging/logger.js";

const repositories = new Map<string, Repository>();
const protectedBranches = new Map<string, ProtectedBranch[]>();

function generateId(prefix: string, stableKey?: string): string {
  if (stableKey) {
    // Deterministic short hash from stable key (e.g., local path)
    let hash = 0;
    for (let i = 0; i < stableKey.length; i++) {
      const char = stableKey.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit int
    }
    const hex = Math.abs(hash).toString(16).padStart(8, "0").slice(0, 8);
    return `${prefix}${hex}`;
  }
  return `${prefix}${crypto.randomUUID().slice(0, 8)}`;
}

function resolveLocalPath(name: string): string {
  const sanitizedName = name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/^-+|-+$/g, "");
  const baseName = sanitizedName || "repo";
  const workspaceRoot = process.env.WORKSPACE_ROOT ?? process.cwd();
  return path.join(workspaceRoot, "repositories", baseName);
}

function validateLocalPath(candidate: string): string {
  if (!candidate || typeof candidate !== "string") {
    throw new Error("Repository path must be a non-empty string");
  }
  const cleaned = candidate.replace(/^["']|["']$/g, "").trim();
  const resolved = path.resolve(cleaned);
  if (process.env.REPOSITORY_ROOT && process.env.REPOSITORY_ROOT.trim() !== "") {
    const root = path.resolve(process.env.REPOSITORY_ROOT.trim());
    const relative = path.relative(root, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("Repository path must be inside REPOSITORY_ROOT");
    }
  }
  return resolved;
}

export class RepositoryStore {
  listRepositories(tenantId: string): readonly Repository[] {
    return [...repositories.values()].filter(
      (r) =>
        (r.tenantId === tenantId || r.tenantId === "tenant-default") &&
        r.status !== "disconnected",
    );
  }

  getRepository(
    repositoryId: string,
    tenantId: string,
  ): Repository | undefined {
    const repo = repositories.get(repositoryId);
    if (
      !repo ||
      (repo.tenantId !== tenantId && repo.tenantId !== "tenant-default")
    )
      return undefined;
    return repo;
  }

  async connectRepository(params: {
    tenantId: string;
    userId: string;
    name: string;
    url: string;
    localPath?: string;
  }): Promise<Repository> {
    const localPath = params.localPath
      ? validateLocalPath(params.localPath)
      : resolveLocalPath(params.name);

    if (params.localPath && !fs.existsSync(localPath)) {
      throw new Error(`Directory does not exist: ${localPath}`);
    }

    const existing = [...repositories.values()].find(
      (r) =>
        r.tenantId === params.tenantId &&
        (r.url === params.url || r.localPath === localPath),
    );

    if (existing) {
      registerRepositoryPath(existing.id, existing.localPath);
      let branch = existing.defaultBranch || "main";
      try {
        const status = await executeGitStatus(existing.localPath);
        branch = status.branch;
      } catch {
        branch = existing.defaultBranch || "main";
      }
      const updated: Repository = {
        ...existing,
        defaultBranch: branch,
        currentBranch: branch,
        status: "connected",
        lastSyncAt: new Date().toISOString(),
      };
      repositories.set(existing.id, updated);
      logger.info("Repository already connected, updating status", {
        operation: "repo-connect",
        metadata: { repositoryId: existing.id },
      });
      return updated;
    }

    let branch = "main";
    try {
      const status = await executeGitStatus(localPath);
      branch = status.branch;
    } catch {
      // Repo may not be cloned yet; we'll attempt clone via git engine later
      branch = "main";
    }

    const repository: Repository = {
      id: generateId("repo-", params.localPath ? localPath.toLowerCase() : undefined),
      tenantId: params.tenantId,
      userId: params.userId,
      name: params.name,
      url: params.url,
      localPath,
      defaultBranch: branch,
      currentBranch: branch,
      status: "connected",
      lastSyncAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      protectedBranches: [],
    };

    repositories.set(repository.id, repository);
    registerRepositoryPath(repository.id, repository.localPath);

    logger.info("Repository connected", {
      operation: "repo-connect",
      metadata: { repositoryId: repository.id, name: params.name },
    });

    return repository;
  }

  async syncRepository(
    repositoryId: string,
    tenantId: string,
  ): Promise<SyncResult> {
    const repo = this.getRepository(repositoryId, tenantId);
    if (!repo) {
      throw new Error("Repository not found");
    }

    const statusBefore = await executeGitStatus(repo.localPath);

    const result: SyncResult = {
      repositoryId,
      status: "success",
      ahead: statusBefore.ahead,
      behind: statusBefore.behind,
      mergedBranches: [],
      conflicts: [],
    };

    const updated: Repository = {
      ...repo,
      status: "syncing",
    };
    repositories.set(repositoryId, updated);

    await new Promise((resolve) => setTimeout(resolve, 100));

    const finalStatus = await executeGitStatus(repo.localPath);

    const finalRepo: Repository = {
      ...repo,
      currentBranch: finalStatus.branch,
      lastSyncAt: new Date().toISOString(),
      status: finalStatus.clean ? "connected" : "connected",
    };
    repositories.set(repositoryId, finalRepo);

    logger.info("Repository synced", {
      operation: "repo-sync",
      metadata: {
        repositoryId,
        ahead: finalStatus.ahead,
        behind: finalStatus.behind,
      },
    });

    return result;
  }

  async disconnectRepository(
    repositoryId: string,
    tenantId: string,
  ): Promise<Repository> {
    const repo = this.getRepository(repositoryId, tenantId);
    if (!repo) {
      throw new Error("Repository not found");
    }

    repositories.delete(repositoryId);

    logger.info("Repository disconnected", {
      operation: "repo-disconnect",
      metadata: { repositoryId },
    });

    return {
      ...repo,
      status: "disconnected",
    };
  }

  async getRepositoryStatus(
    repositoryId: string,
    tenantId: string,
  ): Promise<Repository> {
    const repo = this.getRepository(repositoryId, tenantId);
    if (!repo) {
      throw new Error("Repository not found");
    }

    try {
      const status = await executeGitStatus(repo.localPath);
      const branch = await executeGitStatus(repo.localPath);

      const updated: Repository = {
        ...repo,
        currentBranch: status.branch,
        lastSyncAt: new Date().toISOString(),
        status: "connected",
      };
      repositories.set(repositoryId, updated);

      void branch;
      return updated;
    } catch {
      const updated: Repository = {
        ...repo,
        status: "error",
        lastSyncAt: new Date().toISOString(),
      };
      repositories.set(repositoryId, updated);
      return updated;
    }
  }

  listProtectedBranches(
    repositoryId: string,
    tenantId: string,
  ): readonly ProtectedBranch[] {
    const repo = this.getRepository(repositoryId, tenantId);
    if (!repo) {
      throw new Error("Repository not found");
    }

    const existing = protectedBranches.get(`${tenantId}:${repositoryId}`);
    if (existing) return [...existing];

    const defaultProtected: ProtectedBranch[] = [
      {
        id: generateId("pb-main"),
        name: "main",
        repositoryId,
        allowedPushRoles: ["admin"],
        requiresReview: true,
        requiredApprovals: 1,
        requiresStatusChecks: true,
        requiresLinearHistory: true,
        allowsForcePush: false,
        allowsDeletion: false,
      },
    ];

    protectedBranches.set(`${tenantId}:${repositoryId}`, defaultProtected);
    return [...defaultProtected];
  }

  addProtectedBranch(
    repositoryId: string,
    tenantId: string,
    branchName: string,
    config?: Partial<ProtectedBranch>,
  ): ProtectedBranch {
    const repo = this.getRepository(repositoryId, tenantId);
    if (!repo) {
      throw new Error("Repository not found");
    }

    if (!isProtectedBranch(branchName)) {
      // Still allow adding as protected branch regardless of pattern
    }

    const key = `${tenantId}:${repositoryId}`;
    const existing = protectedBranches.get(key) ?? [];

    const newBranch: ProtectedBranch = {
      id: generateId("pb-"),
      name: branchName,
      repositoryId,
      allowedPushRoles: config?.allowedPushRoles ?? ["admin"],
      requiresReview: config?.requiresReview ?? true,
      requiredApprovals: config?.requiredApprovals ?? 1,
      requiresStatusChecks: config?.requiresStatusChecks ?? true,
      requiresLinearHistory: config?.requiresLinearHistory ?? true,
      allowsForcePush: config?.allowsForcePush ?? false,
      allowsDeletion: config?.allowsDeletion ?? false,
    };

    protectedBranches.set(key, [...existing, newBranch]);
    return newBranch;
  }

  removeProtectedBranch(
    repositoryId: string,
    tenantId: string,
    branchName: string,
  ): boolean {
    const repo = this.getRepository(repositoryId, tenantId);
    if (!repo) {
      throw new Error("Repository not found");
    }

    const key = `${tenantId}:${repositoryId}`;
    const existing = protectedBranches.get(key);
    if (!existing) return false;

    const filtered = existing.filter((b) => b.name !== branchName);
    protectedBranches.set(key, filtered);
    return filtered.length < existing.length;
  }
}

export const repositoryStore = new RepositoryStore();
