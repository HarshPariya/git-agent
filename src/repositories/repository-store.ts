import fs from "node:fs";
import path from "node:path";
import type { Repository, ProtectedBranch, SyncResult } from "../types/git.js";
import { executeGitStatus, registerRepositoryPath } from "../git/engine.js";
import { logger } from "../logging/logger.js";
import { persistRepository, markRepositoryDisconnected, loadRepositoriesFromDb } from "../db/persistence.js";
import { AppError } from "../errors/app-error.js";

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

const resolveLocalPath = (name: string, tenantId?: string): string => {
  const sanitizedName = name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/^-+|-+$/g, "");
  const baseDir = process.env.VERCEL ? "/tmp" : (process.env.WORKSPACE_ROOT ?? process.cwd());
  if (tenantId && tenantId !== "tenant-default") {
    const sanitizedTenant = tenantId.replace(/[^a-z0-9-]/g, "-");
    return path.join(baseDir, "repositories", sanitizedTenant, sanitizedName || "repo");
  }
  return path.join(baseDir, "repositories", sanitizedName || "repo");
};

const validateLocalPath = (candidate: string, repoName?: string, tenantId?: string): string => {
  if (!candidate?.trim()) throw new AppError("Repository path must be a non-empty string", "VALIDATION_ERROR", 400);
  const cleaned = candidate.replace(/^["']|["']$/g, "").trim();

  // If candidate is "." or matches current workspace basename
  const cwd = process.cwd();
  const cwdBase = path.basename(cwd).toLowerCase();
  const isThisProject = repoName ? repoName.toLowerCase() === "git-agent" || repoName.toLowerCase() === cwdBase : false;

  if (cleaned === "." || cleaned === "./") {
    if (isThisProject) return cwd;
    if (repoName) return resolveLocalPath(repoName, tenantId);
    return cwd;
  }
  if (cleaned.toLowerCase() === cwdBase) {
    if (isThisProject) return cwd;
    if (repoName) return resolveLocalPath(repoName, tenantId);
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
      throw new AppError("Repository path must be inside REPOSITORY_ROOT", "VALIDATION_ERROR", 400);
  }

  return resolved;
};

function copyProjectDirectory(sourceDir: string, targetDir: string): void {
  const IGNORED = new Set([".git", "node_modules", ".next", "dist", "build", ".gemini", ".cache", "$RECYCLE.BIN"]);
  if (!fs.existsSync(sourceDir)) return;

  const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    if (IGNORED.has(entry.name) || entry.name.startsWith(".")) continue;
    const srcPath = path.join(sourceDir, entry.name);
    const destPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyProjectDirectory(srcPath, destPath);
    } else if (entry.isFile()) {
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

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

      const isThisProject = repo.name.toLowerCase() === "git-agent";
      // Self-heal: If repo points to /tmp/repositories/ or a non-existent path,
      // but process.cwd() is a git repository matching this repo name, point to process.cwd()
      if (!fs.existsSync(effectivePath) || (effectivePath.includes("/tmp/repositories") && !process.env.VERCEL)) {
        const cwdGit = path.join(process.cwd(), ".git");
        if (fs.existsSync(cwdGit)) {
          const cwdName = path.basename(process.cwd());
          if (repo.name.toLowerCase() === cwdName.toLowerCase() || isThisProject) {
            effectivePath = process.cwd();
            needsPersist = true;
          }
        }
      }

      // Self-heal contaminated URLs: If repo is NOT Git-Agent, but got assigned HarshPariya/git-agent.git
      let effectiveUrl = repo.url;
      if (!isThisProject && effectiveUrl?.includes("HarshPariya/git-agent")) {
        effectiveUrl = undefined;
        needsPersist = true;
        // Clean remote origin from disk if it was mistakenly added
        if (fs.existsSync(effectivePath)) {
          try {
            const { execFileAsync } = await import("../git/utils.js");
            const { stdout: originOut } = await execFileAsync("git", ["config", "--get", "remote.origin.url"], {
              cwd: effectivePath,
            }).catch(() => ({ stdout: "" }));
            if (originOut.trim().includes("HarshPariya/git-agent")) {
              await execFileAsync("git", ["remote", "remove", "origin"], { cwd: effectivePath }).catch(() => {});
            }
          } catch {
            /* ignore */
          }
        }
      }

      const status = await executeGitStatus(effectivePath).catch(() => null);
      const branch = status?.branch && status.branch !== "unknown" ? status.branch : repo.currentBranch || "main";
      const effectiveRepo: Repository = {
        ...repo,
        url: effectiveUrl,
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
    return [...repositories.values()].filter(
      (r) =>
        (!tenantId || r.tenantId === tenantId || (userId && r.userId === userId)) &&
        r.status !== "disconnected" &&
        r.name !== "tmp" &&
        r.localPath !== "/tmp/repositories/tmp",
    );
  }

  getRepository(repositoryId: string, tenantId?: string): Repository | undefined {
    const repo = repositories.get(repositoryId);
    if (!repo) return undefined;
    if (tenantId && repo.tenantId !== tenantId && repo.tenantId !== "tenant-default") {
      return undefined;
    }
    return repo;
  }

  /**
   * Guarantees that the repository workspace directory and git structure exist on disk.
   * Auto-recovers if the Render container restarted and /tmp was wiped.
   */
  async ensureWorkspace(repositoryId: string, tenantId?: string): Promise<string> {
    const repo = this.getRepository(repositoryId, tenantId);
    if (!repo) throw new AppError(`Repository ${repositoryId} not found`, "NOT_FOUND", 404);

    if (!fs.existsSync(repo.localPath) || !fs.existsSync(path.join(repo.localPath, ".git"))) {
      fs.mkdirSync(repo.localPath, { recursive: true });
      const { execFileAsync } = await import("../git/utils.js");
      if (repo.url) {
        try {
          await execFileAsync("git", ["clone", "--depth", "50", repo.url, repo.localPath]);
          logger.info("Restored repository workspace from remote origin", {
            operation: "repo-ensure",
            metadata: { id: repo.id, url: repo.url, path: repo.localPath },
          });
        } catch {
          await execFileAsync("git", ["init", "-b", repo.defaultBranch || "main"], { cwd: repo.localPath });
        }
      } else {
        await execFileAsync("git", ["init", "-b", repo.defaultBranch || "main"], { cwd: repo.localPath });
      }
    }
    return repo.localPath;
  }

  async connectRepository(params: {
    tenantId: string;
    userId: string;
    name: string;
    url: string | undefined;
    localPath: string | undefined;
  }): Promise<Repository> {
    const isGitAgent = params.name.toLowerCase() === "git-agent";
    const cwdBase = path.basename(process.cwd()).toLowerCase();
    const isThisRepo = isGitAgent || params.name.toLowerCase() === cwdBase;

    if (!params.localPath || params.localPath === "." || params.localPath === "./") {
      if (isThisRepo) {
        params.localPath = process.cwd();
      } else {
        params.localPath = resolveLocalPath(params.name, params.tenantId);
      }
    }
    if (isThisRepo && (!params.localPath || !fs.existsSync(params.localPath))) {
      params.localPath = process.cwd();
    }
    let localPath = params.localPath
      ? validateLocalPath(params.localPath, params.name, params.tenantId)
      : resolveLocalPath(params.name, params.tenantId);

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

    let remoteUrl = params.url?.trim() || undefined;

    // Check if localPath already has a git remote configured on disk
    const gitDir = path.join(localPath, ".git");
    if (!remoteUrl && fs.existsSync(gitDir)) {
      try {
        const { execFileAsync } = await import("../git/utils.js");
        const { stdout: originOut } = await execFileAsync("git", ["config", "--get", "remote.origin.url"], {
          cwd: localPath,
        }).catch(() => ({ stdout: "" }));
        const detected = originOut.trim();
        if (detected && (isGitAgent || !detected.includes("HarshPariya/git-agent"))) {
          remoteUrl = detected;
        }
      } catch {
        /* ignore */
      }
    }

    // Default remote URL from env if configured
    if (!remoteUrl && isGitAgent) {
      remoteUrl = process.env.GIT_REPO_URL || process.env.GITHUB_REPO_URL || "";
    }

    // Ensure it is initialized as a valid git repository
    if (!fs.existsSync(gitDir)) {
      try {
        const { execFileAsync } = await import("../git/utils.js");
        let cloned = false;
        if (remoteUrl) {
          try {
            await execFileAsync("git", ["clone", "--depth", "50", remoteUrl, localPath]);
            cloned = true;
          } catch (cloneErr) {
            logger.warn("Direct clone failed, falling back to local init", {
              metadata: { url: remoteUrl, error: String(cloneErr) },
            });
          }
        }
        if (!cloned) {
          await execFileAsync("git", ["init", "-b", "main"], { cwd: localPath });
          // ONLY copy project directory if this IS Git-Agent! Never pollute other projects!
          const sourceRoot = process.cwd();
          if (isGitAgent && sourceRoot && path.resolve(sourceRoot) !== path.resolve(localPath)) {
            copyProjectDirectory(sourceRoot, localPath);
          }
          await execFileAsync("git", ["config", "user.name", "Git Agent"], { cwd: localPath });
          await execFileAsync("git", ["config", "user.email", "agent@git-agent.local"], { cwd: localPath });
          // Create initial commit if files exist
          const hasFiles = fs.readdirSync(localPath).some((f) => f !== ".git");
          if (hasFiles) {
            await execFileAsync("git", ["add", "-A"], { cwd: localPath }).catch(() => {});
            await execFileAsync("git", ["commit", "-m", "Initial commit from Git Agent"], { cwd: localPath }).catch(
              () => {},
            );
          }
          if (remoteUrl) {
            await execFileAsync("git", ["remote", "add", "origin", remoteUrl], { cwd: localPath }).catch(() => {});
          }
        }
      } catch (gitErr) {
        logger.warn("Could not auto-initialize git in workspace", { metadata: { localPath, error: String(gitErr) } });
      }
    } else {
      // Repository already exists.
      // If it has a remote configured that is mistakenly HarshPariya/git-agent on a non-git-agent repo, clean it!
      if (!isGitAgent) {
        try {
          const { execFileAsync } = await import("../git/utils.js");
          const { stdout: originOut } = await execFileAsync("git", ["config", "--get", "remote.origin.url"], {
            cwd: localPath,
          }).catch(() => ({ stdout: "" }));
          if (originOut.trim().includes("HarshPariya/git-agent")) {
            await execFileAsync("git", ["remote", "remove", "origin"], { cwd: localPath }).catch(() => {});
          }
        } catch {
          /* ignore */
        }
      } else if (remoteUrl) {
        try {
          const { execFileAsync } = await import("../git/utils.js");
          const { stdout: commitCountStr } = await execFileAsync("git", ["rev-list", "--count", "HEAD"], {
            cwd: localPath,
          }).catch(() => ({ stdout: "0" }));
          const count = parseInt(commitCountStr.trim(), 10) || 0;
          if (count <= 1) {
            await execFileAsync("git", ["remote", "set-url", "origin", remoteUrl], { cwd: localPath }).catch(() =>
              execFileAsync("git", ["remote", "add", "origin", remoteUrl], { cwd: localPath }),
            );
            await execFileAsync("git", ["fetch", "origin", "main", "--depth=50"], { cwd: localPath }).catch(() => {});
            await execFileAsync("git", ["reset", "--hard", "origin/main"], { cwd: localPath }).catch(() => {});
          }
        } catch (syncErr) {
          logger.warn("Could not sync stub repo with remote", { metadata: { error: String(syncErr) } });
        }
      }
    }

    const existing = [...repositories.values()].find(
      (r) =>
        r.tenantId === params.tenantId &&
        ((params.url && r.url === params.url) ||
          r.localPath.toLowerCase() === localPath.toLowerCase() ||
          r.name.toLowerCase() === params.name.toLowerCase()),
    );

    if (existing) {
      const existingWithUpdatedPath: Repository = {
        ...existing,
        name: params.name || existing.name,
        localPath,
        url: remoteUrl ?? (isGitAgent ? existing.url : undefined),
      };
      return this.reconnectExisting(existingWithUpdatedPath);
    }

    return this.createRepository({ ...params, localPath, url: remoteUrl });
  }

  async syncRepository(repositoryId: string, tenantId: string): Promise<SyncResult> {
    const repo = this.getRepository(repositoryId, tenantId);
    if (!repo) throw new AppError(`Repository ${repositoryId} not found`, "NOT_FOUND", 404);

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

  async disconnectRepository(
    repositoryId: string,
    tenantId: string,
  ): Promise<{ repository: Repository; alreadyDisconnected: boolean }> {
    const repo = this.getRepository(repositoryId, tenantId) ?? repositories.get(repositoryId);
    repositories.delete(repositoryId);
    await markRepositoryDisconnected(repositoryId);

    if (!repo) {
      logger.info("Repository already disconnected (idempotent)", {
        operation: "repo-disconnect",
        metadata: { repositoryId },
      });
      return { repository: { id: repositoryId, status: "disconnected" } as Repository, alreadyDisconnected: true };
    }

    logger.info("Repository disconnected", { operation: "repo-disconnect", metadata: { repositoryId } });
    return { repository: { ...repo, status: "disconnected" }, alreadyDisconnected: false };
  }

  async getRepositoryStatus(repositoryId: string, tenantId: string): Promise<Repository> {
    const repo = this.getRepository(repositoryId, tenantId);
    if (!repo) throw new AppError(`Repository ${repositoryId} not found`, "NOT_FOUND", 404);

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
    if (!repo) throw new AppError(`Repository ${repositoryId} not found`, "NOT_FOUND", 404);

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
    if (!repo) throw new AppError(`Repository ${repositoryId} not found`, "NOT_FOUND", 404);

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
    if (!repo) throw new AppError(`Repository ${repositoryId} not found`, "NOT_FOUND", 404);

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
