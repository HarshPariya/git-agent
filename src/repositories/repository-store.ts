import fs from "node:fs";
import path from "node:path";
import type { Repository, ProtectedBranch, SyncResult } from "../types/git.js";
import { executeGitStatus, registerRepositoryPath } from "../git/engine.js";
import { logger } from "../logging/logger.js";

const repositories = new Map<string, Repository>();
const protectedBranches = new Map<string, ProtectedBranch[]>();

const generateId = (prefix: string, stableKey?: string): string => {
  if (!stableKey) return `${prefix}${crypto.randomUUID().slice(0, 8)}`;
  let hash = 0;
  for (let i = 0; i < stableKey.length; i++) {
    hash = ((hash << 5) - hash) + stableKey.charCodeAt(i);
    hash = hash & hash;
  }
  return `${prefix}${Math.abs(hash).toString(16).padStart(8, "0").slice(0, 8)}`;
};

const resolveLocalPath = (name: string): string => {
  const sanitizedName = name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "");
  return path.join(process.env.WORKSPACE_ROOT ?? process.cwd(), "repositories", sanitizedName || "repo");
};

const validateLocalPath = (candidate: string): string => {
  if (!candidate?.trim()) throw new Error("Repository path must be a non-empty string");
  const resolved = path.resolve(candidate.replace(/^["']|["']$/g, "").trim());

  const repoRoot = process.env.REPOSITORY_ROOT?.trim();
  if (repoRoot) {
    const relative = path.relative(path.resolve(repoRoot), resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Repository path must be inside REPOSITORY_ROOT");
  }

  return resolved;
};

const sanitizeDefaultBranch = (branch: string): string =>
  branch && !branch.startsWith("feature/") && !branch.startsWith("fix/") ? branch : "development";

export class RepositoryStore {
  listRepositories(tenantId: string): readonly Repository[] {
    return [...repositories.values()].filter((r) =>
      (r.tenantId === tenantId || r.tenantId === "tenant-default") && r.status !== "disconnected",
    );
  }

  getRepository(repositoryId: string, tenantId: string): Repository | undefined {
    const repo = repositories.get(repositoryId);
    return repo?.tenantId === tenantId || repo?.tenantId === "tenant-default" ? repo : undefined;
  }

  async connectRepository(params: {
    tenantId: string;
    userId: string;
    name: string;
    url: string | undefined;
    localPath: string | undefined;
  }): Promise<Repository> {
    const localPath = params.localPath ? validateLocalPath(params.localPath) : resolveLocalPath(params.name);
    if (params.localPath && !fs.existsSync(localPath)) throw new Error(`Directory does not exist: ${localPath}`);

    const existing = [...repositories.values()].find(
      (r) => r.tenantId === params.tenantId && (r.url === params.url || r.localPath === localPath),
    );

    if (existing) return this.reconnectExisting(existing);

    return this.createRepository({ ...params, localPath });
  }

  async syncRepository(repositoryId: string, tenantId: string): Promise<SyncResult> {
    const repo = this.getRepository(repositoryId, tenantId);
    if (!repo) throw new Error("Repository not found");

    const statusBefore = await executeGitStatus(repo.localPath);
    const result: SyncResult = { repositoryId, status: "success", ahead: statusBefore.ahead, behind: statusBefore.behind, mergedBranches: [], conflicts: [] };

    repositories.set(repositoryId, { ...repo, status: "syncing" });
    await new Promise((resolve) => setTimeout(resolve, 100));

    const finalStatus = await executeGitStatus(repo.localPath);
    repositories.set(repositoryId, { ...repo, currentBranch: finalStatus.branch, lastSyncAt: new Date().toISOString(), status: "connected" });
    logger.info("Repository synced", { operation: "repo-sync", metadata: { repositoryId, ahead: finalStatus.ahead, behind: finalStatus.behind } });

    return result;
  }

  async disconnectRepository(repositoryId: string, tenantId: string): Promise<Repository> {
    const repo = this.getRepository(repositoryId, tenantId);
    if (!repo) throw new Error("Repository not found");

    repositories.delete(repositoryId);
    logger.info("Repository disconnected", { operation: "repo-disconnect", metadata: { repositoryId } });
    return { ...repo, status: "disconnected" };
  }

  async getRepositoryStatus(repositoryId: string, tenantId: string): Promise<Repository> {
    const repo = this.getRepository(repositoryId, tenantId);
    if (!repo) throw new Error("Repository not found");

    const status = await executeGitStatus(repo.localPath).catch(() => null);
    const updated: Repository = status
      ? { ...repo, currentBranch: status.branch, lastSyncAt: new Date().toISOString(), status: "connected" }
      : { ...repo, status: "error", lastSyncAt: new Date().toISOString() };

    repositories.set(repositoryId, updated);
    return updated;
  }

  listProtectedBranches(repositoryId: string, tenantId: string): readonly ProtectedBranch[] {
    const repo = this.getRepository(repositoryId, tenantId);
    if (!repo) throw new Error("Repository not found");

    const key = `${tenantId}:${repositoryId}`;
    const existing = protectedBranches.get(key);
    if (existing) return [...existing];

    const defaultProtected: ProtectedBranch[] = [{
      id: generateId("pb-main"), name: "main", repositoryId,
      allowedPushRoles: ["admin"], requiresReview: true, requiredApprovals: 1,
      requiresStatusChecks: true, requiresLinearHistory: true, allowsForcePush: false, allowsDeletion: false,
    }];
    protectedBranches.set(key, defaultProtected);
    return [...defaultProtected];
  }

  addProtectedBranch(repositoryId: string, tenantId: string, branchName: string, config?: Partial<ProtectedBranch>): ProtectedBranch {
    const repo = this.getRepository(repositoryId, tenantId);
    if (!repo) throw new Error("Repository not found");

    const key = `${tenantId}:${repositoryId}`;
    const existing = protectedBranches.get(key) ?? [];
    const newBranch: ProtectedBranch = {
      id: generateId("pb-"), name: branchName, repositoryId,
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

  removeProtectedBranch(repositoryId: string, tenantId: string, branchName: string): boolean {
    const repo = this.getRepository(repositoryId, tenantId);
    if (!repo) throw new Error("Repository not found");

    const key = `${tenantId}:${repositoryId}`;
    const existing = protectedBranches.get(key);
    if (!existing) return false;

    const filtered = existing.filter((b) => b.name !== branchName);
    protectedBranches.set(key, filtered);
    return filtered.length < existing.length;
  }

  private async reconnectExisting(existing: Repository): Promise<Repository> {
    registerRepositoryPath(existing.id, existing.localPath);
    const status = await executeGitStatus(existing.localPath).catch(() => null);
    const current = status?.branch ?? existing.currentBranch ?? "feature/git-agent";
    const updated: Repository = { ...existing, defaultBranch: sanitizeDefaultBranch(existing.defaultBranch), currentBranch: current, status: "connected", lastSyncAt: new Date().toISOString() };

    repositories.set(existing.id, updated);
    logger.info("Repository already connected, updating status", { operation: "repo-connect", metadata: { repositoryId: existing.id } });
    return updated;
  }

  private async createRepository(params: {
    tenantId: string;
    userId: string;
    name: string;
    url: string | undefined;
    localPath: string;
  }): Promise<Repository> {
    const status = await executeGitStatus(params.localPath).catch(() => null);
    const branch = status?.branch ?? "feature/git-agent";

    const repository: Repository = {
      id: generateId("repo-", params.localPath ? params.localPath.toLowerCase() : undefined),
      tenantId: params.tenantId, userId: params.userId, name: params.name, url: params.url,
      localPath: params.localPath, defaultBranch: sanitizeDefaultBranch(branch), currentBranch: branch,
      status: "connected", lastSyncAt: new Date().toISOString(), createdAt: new Date().toISOString(), protectedBranches: [],
    };

    repositories.set(repository.id, repository);
    registerRepositoryPath(repository.id, repository.localPath);
    logger.info("Repository connected", { operation: "repo-connect", metadata: { repositoryId: repository.id, name: params.name } });
    return repository;
  }
}

export const repositoryStore = new RepositoryStore();
