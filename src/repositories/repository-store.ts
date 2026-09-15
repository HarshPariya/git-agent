import fs from "node:fs";
import path from "node:path";
import type { Repository, ProtectedBranch, SyncResult } from "../types/git.js";
import { executeGitStatus, registerRepositoryPath } from "../git/engine.js";
import { logger } from "../logging/logger.js";
import { persistRepository, markRepositoryDisconnected, loadRepositoriesFromDb } from "../db/persistence.js";

const repositories = new Map<string, Repository>();
const protectedBranches = new Map<string, ProtectedBranch[]>();

const generateId = (prefix: string, stableKey?: string): string => {
  if (!stableKey) return `${prefix}${crypto.randomUUID().slice(0, 8)}`;
  let hash = 0;
  for (let i = 0; i < stableKey.length; i++) {
    hash = (hash << 5) - hash + stableKey.charCodeAt(i);
    hash = hash & hash;
  }
  return `${prefix}${Math.abs(hash).toString(16).padStart(8, "0").slice(0, 8)}`;
};

const resolveLocalPath = (name: string): string => {
  const sanitizedName = name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/^-+|-+$/g, "");
  const baseDir = process.env.VERCEL ? "/tmp" : (process.env.WORKSPACE_ROOT ?? process.cwd());
  return path.join(baseDir, "repositories", sanitizedName || "repo");
};

const validateLocalPath = (candidate: string): string => {
  if (!candidate?.trim()) throw new Error("Repository path must be a non-empty string");
  const cleaned = candidate.replace(/^["']|["']$/g, "").trim();

  // If candidate is "." or matches current workspace basename
  const cwd = process.cwd();
  if (cleaned === "." || cleaned === "./" || cleaned.toLowerCase() === path.basename(cwd).toLowerCase()) {
    return cwd;
  }

  // If candidate already exists on the local machine
  if (fs.existsSync(cleaned)) {
    return path.resolve(cleaned);
  }

  // Check sibling directory: e.g. parent of cwd
  const sibling = path.resolve(path.dirname(cwd), cleaned);
  if (fs.existsSync(sibling)) {
    return sibling;
  }

  // If in Vercel serverless environment, local client paths (e.g. C:\... or custom paths)
  // are mapped into the writable /tmp storage.
  if (process.env.VERCEL) {
    const folderName = cleaned.split(/[\\/]/).filter(Boolean).pop() || "repo";
    const sanitizedName = folderName
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/^-+|-+$/g, "");
    return path.join("/tmp", "repositories", sanitizedName || "repo");
  }

  const resolved = path.resolve(cleaned);

  const repoRoot = process.env.REPOSITORY_ROOT?.trim();
  if (repoRoot) {
    const relative = path.relative(path.resolve(repoRoot), resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative))
      throw new Error("Repository path must be inside REPOSITORY_ROOT");
  }

  return resolved;
};

const sanitizeDefaultBranch = (branch: string): string =>
  branch && !branch.startsWith("feature/") && !branch.startsWith("fix/") ? branch : "main";

export class RepositoryStore {
  /**
   * Hydrate the in-memory repository map from MongoDB at startup.
   * This is called once during server boot so the dashboard always shows
   * previously-connected repositories.
   */
  async hydrateFromDb(): Promise<void> {
    const repos = await loadRepositoriesFromDb();
    let count = 0;
    for (const repo of repos) {
      if (repo.name === "tmp" || repo.localPath === "/tmp/repositories/tmp") continue;
      let effectivePath = repo.localPath;
      let needsPersist = false;

      // Self-heal: If repo points to /tmp/repositories/ or a non-existent path,
      // but process.cwd() is a git repository matching this repo name, point to process.cwd()
      if (!fs.existsSync(effectivePath) || (effectivePath.includes("/tmp/repositories") && !process.env.VERCEL)) {
        const cwdGit = path.join(process.cwd(), ".git");
        if (fs.existsSync(cwdGit)) {
          const cwdName = path.basename(process.cwd());
          if (repo.name.toLowerCase() === cwdName.toLowerCase() || repos.length === 1) {
            effectivePath = process.cwd();
            needsPersist = true;
          }
        }
      }

      const status = await executeGitStatus(effectivePath).catch(() => null);
      const branch = status?.branch && status.branch !== "unknown" ? status.branch : repo.currentBranch || "main";
      const effectiveRepo: Repository = {
        ...repo,
        localPath: effectivePath,
        currentBranch: branch,
        defaultBranch: sanitizeDefaultBranch(branch || repo.defaultBranch),
        status: "connected",
      };
      repositories.set(repo.id, effectiveRepo);
      registerRepositoryPath(repo.id, effectivePath);

      if (needsPersist) {
        await persistRepository(effectiveRepo).catch(() => {});
      }
      count++;
    }
    if (count > 0) {
      logger.info("Hydrated repository store from database", {
        operation: "repo-hydrate",
        metadata: { count },
      });
    }
  }

  async listRepositories(tenantId?: string, userId?: string): Promise<readonly Repository[]> {
    if (repositories.size === 0 || process.env.VERCEL) {
      await this.hydrateFromDb();
    }
    const list = [...repositories.values()].filter(
      (r) =>
        (!tenantId || r.tenantId === tenantId || r.tenantId === "tenant-default" || (userId && r.userId === userId)) &&
        r.status !== "disconnected" &&
        r.name !== "tmp" &&
        r.localPath !== "/tmp/repositories/tmp",
    );

    // If tenant has no repos configured yet, check if workspace repository (process.cwd()) exists and surface it
    if (list.length === 0 && tenantId) {
      const workspaceRepo = [...repositories.values()].find(
        (r) =>
          r.status !== "disconnected" &&
          r.name !== "tmp" &&
          r.localPath &&
          path.resolve(r.localPath).toLowerCase() === path.resolve(process.cwd()).toLowerCase(),
      );
      if (workspaceRepo) {
        return [workspaceRepo];
      }
    }

    return list;
  }

  getRepository(repositoryId: string, tenantId?: string): Repository | undefined {
    const repo = repositories.get(repositoryId);
    if (!repo) return undefined;
    if (!tenantId || repo.tenantId === tenantId || repo.tenantId === "tenant-default") return repo;
    return repo;
  }

  async connectRepository(params: {
    tenantId: string;
    userId: string;
    name: string;
    url: string | undefined;
    localPath: string | undefined;
  }): Promise<Repository> {
    if (!params.localPath || params.localPath === "." || params.localPath === "./") {
      params.localPath = process.cwd();
    }
    const cwdBase = path.basename(process.cwd()).toLowerCase();
    if (params.name && params.name.toLowerCase() === cwdBase) {
      if (!params.localPath || !fs.existsSync(params.localPath)) {
        params.localPath = process.cwd();
      }
    }
    let localPath = params.localPath ? validateLocalPath(params.localPath) : resolveLocalPath(params.name);

    // Auto-provision directory if running on Vercel or if path doesn't exist yet
    if (!fs.existsSync(localPath)) {
      try {
        fs.mkdirSync(localPath, { recursive: true });
      } catch {
        // Fallback to /tmp if write permission fails in current cwd
        const sanitizedName = params.name
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, "-")
          .replace(/^-+|-+$/g, "");
        localPath = path.join("/tmp", "repositories", sanitizedName || "repo");
        fs.mkdirSync(localPath, { recursive: true });
      }
    }

    // Ensure it is initialized as a valid git repository
    const gitDir = path.join(localPath, ".git");
    if (!fs.existsSync(gitDir)) {
      try {
        const { execFileAsync } = await import("../git/utils.js");
        let cloned = false;
        if (params.url) {
          try {
            await execFileAsync("git", ["clone", "--depth", "100", params.url, localPath]);
            cloned = true;
          } catch (cloneErr) {
            logger.warn("Direct clone failed, falling back to init and remote add", {
              metadata: { url: params.url, error: String(cloneErr) },
            });
          }
        }
        if (!cloned) {
          await execFileAsync("git", ["init", "-b", "main"], { cwd: localPath });
          const readmePath = path.join(localPath, "README.md");
          if (!fs.existsSync(readmePath)) {
            fs.writeFileSync(
              readmePath,
              `# ${params.name}\n\nWorkspace repository managed by Git Debug Agent.\n\nCreated: ${new Date().toISOString()}\n`,
            );
            await execFileAsync("git", ["config", "user.name", "Git Agent"], { cwd: localPath });
            await execFileAsync("git", ["config", "user.email", "agent@git-agent.local"], { cwd: localPath });
            await execFileAsync("git", ["add", "README.md"], { cwd: localPath });
            await execFileAsync("git", ["commit", "-m", "Initial commit from Git Agent"], { cwd: localPath });
          }
          if (params.url) {
            await execFileAsync("git", ["remote", "add", "origin", params.url], { cwd: localPath }).catch(() => {});
            await execFileAsync("git", ["pull", "origin", "main", "--allow-unrelated-histories"], { cwd: localPath }).catch(() => {});
          }
        }
      } catch (gitErr) {
        logger.warn("Could not auto-initialize git in workspace", { metadata: { localPath, error: String(gitErr) } });
      }
    } else if (params.url) {
      try {
        const { execFileAsync } = await import("../git/utils.js");
        await execFileAsync("git", ["remote", "add", "origin", params.url], { cwd: localPath }).catch(() => {});
      } catch {
        // remote might already exist
      }
    }

    const existing = [...repositories.values()].find(
      (r) =>
        r.tenantId === params.tenantId &&
        (r.url === params.url ||
          r.localPath.toLowerCase() === localPath.toLowerCase() ||
          r.name.toLowerCase() === params.name.toLowerCase()),
    );

    if (existing) {
      const existingWithUpdatedPath: Repository = {
        ...existing,
        name: params.name || existing.name,
        localPath,
        url: params.url ?? existing.url,
      };
      return this.reconnectExisting(existingWithUpdatedPath);
    }

    return this.createRepository({ ...params, localPath });
  }

  async syncRepository(repositoryId: string, tenantId: string): Promise<SyncResult> {
    const repo = this.getRepository(repositoryId, tenantId);
    if (!repo) throw new Error("Repository not found");

    const statusBefore = await executeGitStatus(repo.localPath);
    const result: SyncResult = {
      repositoryId,
      status: "success",
      ahead: statusBefore.ahead,
      behind: statusBefore.behind,
      mergedBranches: [],
      conflicts: [],
    };

    repositories.set(repositoryId, { ...repo, status: "syncing" });
    await new Promise((resolve) => setTimeout(resolve, 100));

    const finalStatus = await executeGitStatus(repo.localPath);
    const synced: Repository = {
      ...repo,
      currentBranch: finalStatus.branch,
      lastSyncAt: new Date().toISOString(),
      status: "connected",
    };
    repositories.set(repositoryId, synced);
    await persistRepository(synced);
    logger.info("Repository synced", {
      operation: "repo-sync",
      metadata: { repositoryId, ahead: finalStatus.ahead, behind: finalStatus.behind },
    });

    return result;
  }

  async disconnectRepository(repositoryId: string, tenantId: string): Promise<Repository> {
    const repo = this.getRepository(repositoryId, tenantId);
    if (!repo) throw new Error("Repository not found");

    repositories.delete(repositoryId);
    await markRepositoryDisconnected(repositoryId);
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
    await persistRepository(updated);
    return updated;
  }

  listProtectedBranches(repositoryId: string, tenantId: string): readonly ProtectedBranch[] {
    const repo = this.getRepository(repositoryId, tenantId);
    if (!repo) throw new Error("Repository not found");

    const key = `${tenantId}:${repositoryId}`;
    const existing = protectedBranches.get(key);
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
    protectedBranches.set(key, defaultProtected);
    return [...defaultProtected];
  }

  addProtectedBranch(
    repositoryId: string,
    tenantId: string,
    branchName: string,
    config?: Partial<ProtectedBranch>,
  ): ProtectedBranch {
    const repo = this.getRepository(repositoryId, tenantId);
    if (!repo) throw new Error("Repository not found");

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
    const current = status?.branch && status.branch !== "unknown" ? status.branch : existing.currentBranch || "main";
    const updated: Repository = {
      ...existing,
      defaultBranch: sanitizeDefaultBranch(current || existing.defaultBranch),
      currentBranch: current,
      status: "connected",
      lastSyncAt: new Date().toISOString(),
    };

    repositories.set(existing.id, updated);
    await persistRepository(updated);
    logger.info("Repository already connected, updating status", {
      operation: "repo-connect",
      metadata: { repositoryId: existing.id, branch: current, path: existing.localPath },
    });
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
    const branch = status?.branch ?? "main";

    const repository: Repository = {
      id: generateId("repo-", params.localPath ? params.localPath.toLowerCase() : undefined),
      tenantId: params.tenantId,
      userId: params.userId,
      name: params.name,
      url: params.url,
      localPath: params.localPath,
      defaultBranch: sanitizeDefaultBranch(branch),
      currentBranch: branch,
      status: "connected",
      lastSyncAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      protectedBranches: [],
    };

    repositories.set(repository.id, repository);
    registerRepositoryPath(repository.id, repository.localPath);
    await persistRepository(repository);
    logger.info("Repository connected", {
      operation: "repo-connect",
      metadata: { repositoryId: repository.id, name: params.name },
    });
    return repository;
  }
}

export const repositoryStore = new RepositoryStore();
