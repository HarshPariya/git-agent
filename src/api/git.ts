import fs from "node:fs/promises";
import syncFs from "node:fs";
import path from "node:path";
import type { NextFunction, Request, Response } from "express";
import {
  classifyOperation,
  executeGitBranches,
  executeGitDiff,
  executeGitLog,
  executeGitOperation,
  executeGitStatus,
  getExecutionPath,
  registerRepositoryPath,
  getRiskLabel,
  GIT_OPERATION_CATALOG,
  executeGitStashList,
  executeGitStashPush,
  executeGitStashPop,
  executeGitStashDrop,
  executeGitStashShow,
  executeGitApplyHunk,
  executeGitDiscardFile,
  executeGitUndoCommit,
  executeGitLogGraph,
  type GitOperationType,
} from "../git/engine.js";
import { scanContentForSecrets } from "../guardrails/secrets-scanner.js";
import { AppError } from "../errors/app-error.js";
import { conflictAnalyzer } from "../git/conflicts.js";
import { executeSafeCommit } from "../git/commit.js";
import { executeSafePush } from "../git/push.js";
import {
  analyzeAndPlanCommits,
  planFromChangedFiles,
  executeCommitPlan,
  type LogicalChangeGroup,
  type ChangedFileDetail,
} from "../git/change-analyzer.js";
import { getGitHubToken } from "../github/auth.js";
import { createGitHubPR } from "../github/pull-requests.js";
import { generateText } from "../llm/client.js";
import { execAsync, validateBranchName, validateRemoteName, escapeShellArg, validateFilePath } from "../git/utils.js";
import { logger } from "../logging/logger.js";

const getGitRequestData = (request: Request): Record<string, unknown> => ({
  ...(request.query as Record<string, unknown>),
  ...(typeof request.body === "object" && request.body !== null ? (request.body as Record<string, unknown>) : {}),
});

const requireString = (body: Record<string, unknown>, key: string): string => {
  const value = body[key];
  if (typeof value !== "string" || !value.trim()) throw new AppError(`${key} is required`, "VALIDATION_ERROR", 400);
  return value.trim();
};

const optionalString = (body: Record<string, unknown>, key: string): string | undefined => {
  const value = body[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
};

const noop = (): void => {
  /* no-op fallback */
};

const validateRepositoryAccess = async (repoId: string, tenantId?: string): Promise<void> => {
  try {
    const { repositoryStore } = await import("../repositories/repository-store.js");
    let repo = repositoryStore.getRepository(repoId, tenantId);
    if (!repo) {
      await repositoryStore.hydrateFromDb();
      repo = repositoryStore.getRepository(repoId, tenantId);
    }
    if (!repo) {
      throw new AppError(`Repository "${repoId}" not found or unauthorized`, "NOT_FOUND", 404);
    }
    const execPath = await repositoryStore.ensureWorkspace(repoId, tenantId);
    registerRepositoryPath(repoId, execPath);
    await executeGitStatus(repoId);
  } catch (err) {
    if (err instanceof AppError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new AppError(`Repository workspace inaccessible: ${msg}`, "VALIDATION_ERROR", 400);
  }
};

const executeGitCommand = async (
  cmd: string,
  cwd: string,
  timeout = 60000,
): Promise<{ success: boolean; output: string; error?: string | undefined }> => {
  try {
    const { stdout, stderr } = await execAsync(cmd, { cwd, timeout });
    return { success: true, output: stdout.trim() || stderr.trim() || "Operation completed." };
  } catch (err: unknown) {
    const error = err as { stdout?: string; stderr?: string; message?: string };
    return { success: false, output: error.stdout || "", error: error.stderr || error.message };
  }
};

export async function gitStatusHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const body = getGitRequestData(request);
    const repoId = requireString(body, "repositoryId");
    await validateRepositoryAccess(repoId);
    const status = await executeGitStatus(repoId);
    response.status(200).json(status);
  } catch (error) {
    next(error);
  }
}

/**
 * Server-Sent Events (SSE) stream for real-time repository changes.
 * Watches the local repository with fs.watch, debouncing by 150ms.
 * Whenever a file changes, pushes an event with executeGitStatus(repoId).
 */
export async function gitStreamStatusHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const repoId = (request.params.repositoryId || request.query.repositoryId) as string;
    if (!repoId) throw new AppError("repositoryId is required", "VALIDATION_ERROR", 400);

    await validateRepositoryAccess(repoId);
    const execPath = getExecutionPath(repoId);

    // Set SSE headers
    response.setHeader("Content-Type", "text/event-stream");
    response.setHeader("Cache-Control", "no-cache, no-transform");
    response.setHeader("Connection", "keep-alive");
    response.setHeader("X-Accel-Buffering", "no");
    response.flushHeaders?.();

    // Send initial status immediately
    const initialStatus = await executeGitStatus(repoId).catch(() => null);
    if (initialStatus) {
      response.write(`event: git-status\ndata: ${JSON.stringify({ repositoryId: repoId, status: initialStatus })}\n\n`);
    }

    // Keep-alive heartbeat every 20s
    const heartbeatTimer = setInterval(() => {
      response.write(`: heartbeat\n\n`);
    }, 20000);

    // Setup debounced fs.watch on repository directory
    let debounceTimer: NodeJS.Timeout | null = null;
    let isPushing = false;

    const pushLatestStatus = async () => {
      if (isPushing) return;
      isPushing = true;
      try {
        const latest = await executeGitStatus(repoId);
        response.write(`event: git-status\ndata: ${JSON.stringify({ repositoryId: repoId, status: latest })}\n\n`);
      } catch {
        // Silently skip status failure if git command was locked momentarily
      } finally {
        isPushing = false;
      }
    };

    const ignoredParts = new Set([".git", "node_modules", ".cache", "dist", ".gemini"]);

    let watcher: syncFs.FSWatcher | null = null;
    try {
      watcher = syncFs.watch(execPath, { recursive: true }, (_eventType, filename) => {
        if (!filename) return;
        const parts = filename.split(/[\\/]/);
        if (parts.some((p) => ignoredParts.has(p))) return;

        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          void pushLatestStatus();
        }, 150);
      });
    } catch (watchErr) {
      logger.warn("Could not start fs.watch on repository directory", {
        metadata: { execPath, error: String(watchErr) },
      });
    }

    // Clean up on client disconnect
    request.on("close", () => {
      clearInterval(heartbeatTimer);
      if (debounceTimer) clearTimeout(debounceTimer);
      if (watcher) {
        watcher.close();
        watcher = null;
      }
    });
  } catch (error) {
    next(error);
  }
}

export async function gitSyncFileHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const body = getGitRequestData(request);
    const repoId = requireString(body, "repositoryId");
    const filePath = requireString(body, "filePath");
    const content = typeof body.content === "string" ? body.content : undefined;
    const action = typeof body.action === "string" ? body.action : "write";

    await validateRepositoryAccess(repoId);
    const execPath = getExecutionPath(repoId);
    const targetFile = path.resolve(execPath, filePath);

    // Prevent path traversal outside repo
    const relative = path.relative(execPath, targetFile);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new AppError("Invalid file path for sync", "AUTHORIZATION_ERROR", 403);
    }

    const posixPath = filePath.replace(/\\/g, "/");

    if (action === "delete") {
      if (syncFs.existsSync(targetFile)) {
        await syncFs.promises.unlink(targetFile);
      }
      await execAsync(`git clean -fd -- "${posixPath}"`, { cwd: execPath }).catch(noop);
    } else {
      await syncFs.promises.mkdir(path.dirname(targetFile), { recursive: true });

      // Check if file exists in HEAD and compare normalized content
      let restoredToHead = false;
      try {
        const { stdout: headContent } = await execAsync(`git show HEAD:"${posixPath}"`, { cwd: execPath });
        const normHead = headContent.replace(/\r\n/g, "\n");
        const normIncoming = (content ?? "").replace(/\r\n/g, "\n");
        if (normHead === normIncoming) {
          restoredToHead = true;
          // Checkout clean version directly from HEAD to keep git index and timestamps in perfect sync
          await execAsync(`git checkout HEAD -- "${posixPath}"`, { cwd: execPath });
        }
      } catch {
        // File may not exist in HEAD yet
      }

      if (!restoredToHead) {
        await syncFs.promises.writeFile(targetFile, content ?? "", "utf8");
        // Verify if writing caused any actual diff from HEAD
        try {
          await execAsync(`git diff --quiet -- "${posixPath}"`, { cwd: execPath });
          // Exit 0 means working file is identical to index/HEAD
          await execAsync(`git checkout HEAD -- "${posixPath}"`, { cwd: execPath }).catch(noop);
        } catch {
          // Has actual diff, legitimate modification
        }
      }
    }

    // Refresh index so git immediately detects if file is restored back to clean HEAD
    await execAsync("git update-index -q --refresh", { cwd: execPath }).catch(noop);

    const latest = await executeGitStatus(repoId);
    response.status(200).json({ success: true, filePath, status: latest });
  } catch (error) {
    next(error);
  }
}

export async function gitSyncWorkspaceHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const body = getGitRequestData(request);
    const repoId = requireString(body, "repositoryId");
    const files = Array.isArray(body.files) ? (body.files as Array<{ filePath: string; content: string }>) : [];
    const commitBaseline = body.commitBaseline === true;

    await validateRepositoryAccess(repoId);
    const execPath = getExecutionPath(repoId);

    let written = 0;
    for (const f of files) {
      if (!f || typeof f.filePath !== "string") continue;
      const targetFile = path.resolve(execPath, f.filePath);
      const relative = path.relative(execPath, targetFile);
      if (relative.startsWith("..") || path.isAbsolute(relative)) continue;

      await syncFs.promises.mkdir(path.dirname(targetFile), { recursive: true });
      await syncFs.promises.writeFile(targetFile, typeof f.content === "string" ? f.content : "", "utf8");
      written++;
    }

    if (commitBaseline && written > 0) {
      await execAsync("git add -A", { cwd: execPath }).catch(noop);
      const { stdout: statusOut } = await execAsync("git status --porcelain=v1", { cwd: execPath }).catch(() => ({
        stdout: "",
      }));
      if (statusOut.trim()) {
        await execAsync('git commit -m "Initialize project baseline"', { cwd: execPath }).catch(noop);
      }
    }

    await execAsync("git update-index --refresh", { cwd: execPath }).catch(noop);

    const latest = await executeGitStatus(repoId);
    response.status(200).json({ success: true, count: written, status: latest });
  } catch (error) {
    next(error);
  }
}

export async function gitCommitBaselineHandler(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = getGitRequestData(request);
    const repoId = requireString(body, "repositoryId");
    await validateRepositoryAccess(repoId);
    const execPath = getExecutionPath(repoId);

    // Ensure standard .gitignore is present if not already created, ignoring caches and binary artifacts
    const gitignorePath = path.join(execPath, ".gitignore");
    if (!syncFs.existsSync(gitignorePath)) {
      await syncFs.promises
        .writeFile(
          gitignorePath,
          `node_modules/\n__pycache__/\n*.py[cod]\n*$py.class\n.venv/\nvenv/\nenv/\n.env\n.DS_Store\nThumbs.db\ndist/\nbuild/\n.cache/\ncoverage/\n*.log\n*.tmp\nscratch/\n`,
          "utf8",
        )
        .catch(noop);
    }

    // Remove any previously pushed binary bytecode or cache files
    await execAsync('git clean -fd -- "*.pyc" "*.pyo" "__pycache__"', { cwd: execPath }).catch(noop);
    await execAsync("git add -A", { cwd: execPath }).catch(noop);
    const { stdout: statusOut } = await execAsync("git status --porcelain=v1", { cwd: execPath }).catch(() => ({
      stdout: "",
    }));
    if (statusOut.trim()) {
      await execAsync('git commit -m "Initialize project baseline"', { cwd: execPath }).catch(noop);
    }
    await execAsync("git update-index --refresh", { cwd: execPath }).catch(noop);

    const latest = await executeGitStatus(repoId);
    response.status(200).json({ success: true, status: latest });
  } catch (error) {
    next(error);
  }
}

export async function gitLogHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const body = getGitRequestData(request);
    const repoId = requireString(body, "repositoryId");
    await validateRepositoryAccess(repoId);
    const count = typeof body.count === "number" ? body.count : typeof body.maxCount === "number" ? body.maxCount : 20;
    const branch = optionalString(body, "branch");
    const entries = await executeGitLog(repoId, { count, ...(branch !== undefined && { branch }) });
    response.status(200).json({ commits: entries, entries });
  } catch (error) {
    next(error);
  }
}

export async function gitConflictsHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const body = getGitRequestData(request);
    const repoId = requireString(body, "repositoryId");
    await validateRepositoryAccess(repoId);
    const result = await conflictAnalyzer.analyzeRepository(getExecutionPath(repoId));
    response.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function gitConflictResolveHandler(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = getGitRequestData(request);
    const repoId = requireString(body, "repositoryId");
    const repoPath = getExecutionPath(repoId);

    if (typeof body.ours === "string" && typeof body.theirs === "string") {
      const filePath = typeof body.filePath === "string" ? body.filePath : "unknown";
      const resolution = await conflictAnalyzer.resolveFile({
        filePath,
        hasConflicts: true,
        markers: [
          {
            filePath,
            startLine: 1,
            endLine: 1,
            baseLines: typeof body.base === "string" ? body.base.split("\n") : [],
            ourLines: body.ours.split("\n"),
            theirLines: body.theirs.split("\n"),
          },
        ],
      });
      response.status(200).json({
        filePath,
        resolution: resolution.resolvedContent,
        strategy: resolution.strategy,
        confidence: resolution.confidence,
        explanation: resolution.explanation,
      });
      return;
    }

    const result = await conflictAnalyzer.resolveAllConflicts(repoPath);
    response.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function gitCommitHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const body = getGitRequestData(request);
    const repoId = requireString(body, "repositoryId");
    const message = optionalString(body, "message");
    const files = Array.isArray(body.files) ? (body.files as string[]) : undefined;
    const result = await executeSafeCommit(getExecutionPath(repoId), {
      ...(message !== undefined ? { message } : {}),
      stageAll: body.stageAll !== false && (!files || files.length === 0),
      ...(files ? { files } : {}),
    });
    response.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    next(error);
  }
}

export async function gitStageHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const body = getGitRequestData(request);
    const repoId = requireString(body, "repositoryId");
    const filePath = validateFilePath(requireString(body, "filePath"));
    const repoPath = getExecutionPath(repoId);
    await execAsync(`git add "${filePath.replace(/"/g, '\\"')}"`, { cwd: repoPath });
    const status = await executeGitStatus(repoId);
    response.status(200).json({ success: true, status });
  } catch (error) {
    next(error);
  }
}

export async function gitUnstageHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const body = getGitRequestData(request);
    const repoId = requireString(body, "repositoryId");
    const filePath = validateFilePath(requireString(body, "filePath"));
    const repoPath = getExecutionPath(repoId);
    await execAsync(`git reset HEAD "${filePath.replace(/"/g, '\\"')}"`, { cwd: repoPath }).catch(async () => {
      await execAsync(`git rm --cached "${filePath.replace(/"/g, '\\"')}"`, { cwd: repoPath }).catch(noop);
    });
    const status = await executeGitStatus(repoId);
    response.status(200).json({ success: true, status });
  } catch (error) {
    next(error);
  }
}

export async function gitStageAllHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const body = getGitRequestData(request);
    const repoId = requireString(body, "repositoryId");
    const repoPath = getExecutionPath(repoId);
    await execAsync("git add -A", { cwd: repoPath });
    const status = await executeGitStatus(repoId);
    response.status(200).json({ success: true, status });
  } catch (error) {
    next(error);
  }
}

export async function gitUnstageAllHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const body = getGitRequestData(request);
    const repoId = requireString(body, "repositoryId");
    const repoPath = getExecutionPath(repoId);
    await execAsync("git reset HEAD", { cwd: repoPath }).catch(noop);
    const status = await executeGitStatus(repoId);
    response.status(200).json({ success: true, status });
  } catch (error) {
    next(error);
  }
}

export async function gitDiscardHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const body = getGitRequestData(request);
    const repoId = requireString(body, "repositoryId");
    const rawFilePath = optionalString(body, "filePath");
    const filePath = rawFilePath ? validateFilePath(rawFilePath) : undefined;
    const repoPath = getExecutionPath(repoId);

    let restoredContent: string | null = null;
    let isDeleted = false;

    if (filePath) {
      await execAsync(`git reset HEAD -- "${filePath}"`, { cwd: repoPath }).catch(noop);
      await execAsync(`git checkout -- "${filePath}"`, { cwd: repoPath }).catch(noop);
      await execAsync(`git clean -fd -- "${filePath}"`, { cwd: repoPath }).catch(noop);

      const targetFile = path.resolve(repoPath, filePath);
      if (syncFs.existsSync(targetFile)) {
        restoredContent = await syncFs.promises.readFile(targetFile, "utf8").catch(() => null);
      } else {
        isDeleted = true;
      }
    } else {
      await execAsync("git reset HEAD -- .", { cwd: repoPath }).catch(noop);
      await execAsync("git checkout -- .", { cwd: repoPath }).catch(noop);
      await execAsync("git clean -fd", { cwd: repoPath }).catch(noop);
    }

    await execAsync("git update-index --refresh", { cwd: repoPath }).catch(noop);
    const status = await executeGitStatus(repoId);
    response.status(200).json({ success: true, filePath, restoredContent, isDeleted, status });
  } catch (error) {
    next(error);
  }
}

async function getAuthedRemoteUrl(repoPath: string, remote: string, token?: string): Promise<string> {
  if (!token) return escapeShellArg(remote);
  try {
    const { stdout: originUrl } = await execAsync(`git config --get remote.${remote}.url`, { cwd: repoPath });
    const trimmedUrl = originUrl.trim();
    if (trimmedUrl.includes("github.com")) {
      const authedUrl = trimmedUrl.replace(
        /https:\/\/(?:[^@]+@)?github\.com\//,
        `https://${encodeURIComponent(token)}@github.com/`,
      );
      return escapeShellArg(authedUrl);
    }
  } catch {
    // Fallback to remote name
  }
  return escapeShellArg(remote);
}

export async function gitPushHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const body = getGitRequestData(request);
    const repoId = requireString(body, "repositoryId");
    const remote = optionalString(body, "remote");
    const branch = optionalString(body, "branch");
    const userId =
      request.tenantContext?.userId ?? (request as unknown as { user?: { id?: string } }).user?.id ?? "user-default";
    const explicitToken = optionalString(body, "gitHubToken");
    const gitHubToken = explicitToken ?? getGitHubToken(userId);
    const result = await executeSafePush(getExecutionPath(repoId), {
      ...(remote !== undefined ? { remote } : {}),
      ...(branch !== undefined ? { branch } : {}),
      ...(gitHubToken ? { gitHubToken } : {}),
      setUpstream: body.setUpstream === true,
      forceWithLease: body.forceWithLease === true,
      allowForce: body.allowForce === true,
    });
    response.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    next(error);
  }
}

export async function gitPullHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const body = getGitRequestData(request);
    const repoId = requireString(body, "repositoryId");
    const repoPath = getExecutionPath(repoId);
    const remote = optionalString(body, "remote") ? validateRemoteName(body.remote as string) : "origin";
    const branch = optionalString(body, "branch") ? validateBranchName(body.branch as string) : "";
    const userId =
      request.tenantContext?.userId ?? (request as unknown as { user?: { id?: string } }).user?.id ?? "user-default";
    const explicitToken = optionalString(body, "gitHubToken");
    const gitHubToken = explicitToken ?? getGitHubToken(userId);
    const authedRemote = await getAuthedRemoteUrl(repoPath, remote, gitHubToken);
    const rebase = body.rebase === true ? "--rebase" : "";
    const parts = ["git pull", authedRemote];
    if (branch) parts.push(escapeShellArg(branch));
    if (rebase) parts.push(rebase);
    const cmd = parts.join(" ");

    const result = await executeGitCommand(cmd, repoPath);
    response.status(200).json({ ...result, remote });
  } catch (error) {
    next(error);
  }
}

export async function gitFetchHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const body = getGitRequestData(request);
    const repoId = requireString(body, "repositoryId");
    const repoPath = getExecutionPath(repoId);
    const remote = optionalString(body, "remote") ? validateRemoteName(body.remote as string) : "origin";
    const userId =
      request.tenantContext?.userId ?? (request as unknown as { user?: { id?: string } }).user?.id ?? "user-default";
    const explicitToken = optionalString(body, "gitHubToken");
    const gitHubToken = explicitToken ?? getGitHubToken(userId);
    const authedRemote = await getAuthedRemoteUrl(repoPath, remote, gitHubToken);
    const pruneFlag = body.prune !== false ? "--prune" : "";
    const cmd = ["git fetch", authedRemote, pruneFlag].filter(Boolean).join(" ");

    const result = await executeGitCommand(cmd, repoPath);
    response.status(200).json({ ...result, remote });
  } catch (error) {
    next(error);
  }
}

export async function gitCheckoutHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const body = getGitRequestData(request);
    const repoId = requireString(body, "repositoryId");
    const rawBranch = optionalString(body, "branch");
    if (!rawBranch) throw new AppError("branch is required", "VALIDATION_ERROR", 400);
    const branch = validateBranchName(rawBranch);
    const cmd =
      body.create === true ? `git checkout -b ${escapeShellArg(branch)}` : `git checkout ${escapeShellArg(branch)}`;

    const result = await executeGitCommand(cmd, getExecutionPath(repoId), 30000);
    response.status(200).json({ ...result, branch });
  } catch (error) {
    next(error);
  }
}

export async function gitDiffHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const body = getGitRequestData(request);
    const repoId = requireString(body, "repositoryId");
    await validateRepositoryAccess(repoId);
    const staged = body.staged === true;
    const filePath = optionalString(body, "filePath");
    const repoPath = getExecutionPath(repoId);
    let diffText = "";

    if (filePath) {
      const tryCmds = [
        `git diff -- "${filePath}"`,
        `git diff --cached -- "${filePath}"`,
        `git diff HEAD -- "${filePath}"`,
        `git diff HEAD^..HEAD -- "${filePath}"`,
      ];
      for (const cmd of tryCmds) {
        if (diffText) break;
        try {
          const { stdout } = await execAsync(cmd, { cwd: repoPath });
          if (stdout.trim()) diffText = stdout.trim();
        } catch (err: unknown) {
          logger.warn("git diff command failed", {
            operation: "git-diff",
            metadata: { cmd, error: err instanceof Error ? err.message : String(err) },
          });
        }
      }
      if (!diffText) {
        try {
          await execAsync(`git add -N -- "${filePath}"`, { cwd: repoPath });
          const { stdout: intentDiff } = await execAsync(`git diff -- "${filePath}"`, { cwd: repoPath });
          if (intentDiff.trim()) diffText = intentDiff.trim();
        } catch {
          // Ignore
        }
      }
      if (!diffText) {
        const fullPath = path.resolve(repoPath, filePath);
        if (syncFs.existsSync(fullPath)) {
          try {
            const content = await fs.readFile(fullPath, "utf-8");
            const lines = content.split("\n");
            diffText = [
              `diff --git a/${filePath} b/${filePath}`,
              "new file mode 100644",
              "--- /dev/null",
              `+++ b/${filePath}`,
              `@@ -0,0 +1,${lines.length} @@`,
              ...lines.map((l) => `+${l}`),
            ].join("\n");
          } catch (err: unknown) {
            logger.warn("Failed to read file for diff fallback", {
              operation: "git-diff",
              metadata: { filePath, error: err instanceof Error ? err.message : String(err) },
            });
          }
        } else {
          try {
            const { stdout: headContent } = await execAsync(`git show HEAD:"${filePath}"`, { cwd: repoPath });
            if (headContent) {
              const lines = headContent.split("\n");
              diffText = [
                `diff --git a/${filePath} b/${filePath}`,
                "deleted file mode 100644",
                `--- a/${filePath}`,
                "+++ /dev/null",
                `@@ -1,${lines.length} +0,0 @@`,
                ...lines.map((l) => `-${l}`),
              ].join("\n");
            }
          } catch {
            diffText = `diff --git a/${filePath} b/${filePath}\ndeleted file mode 100644\n--- a/${filePath}\n+++ /dev/null\n@@ -1 +0,0 @@\n-(file deleted)`;
          }
        }
      }
    } else {
      try {
        const { stdout: unstagedOut } = await execAsync("git diff", { cwd: repoPath });
        const { stdout: stagedOut } = await execAsync("git diff --cached", { cwd: repoPath });
        diffText = [unstagedOut.trim(), stagedOut.trim()].filter(Boolean).join("\n");
        const { stdout: untrackedOut } = await execAsync("git ls-files --others --exclude-standard", { cwd: repoPath });
        for (const uFile of untrackedOut
          .split("\n")
          .map((f) => f.trim())
          .filter(Boolean)
          .slice(0, 30)) {
          try {
            const isBinary = /\.(ico|png|jpg|jpeg|gif|webp|woff|woff2|ttf|eot|pdf|zip|tar|gz|exe|dll)$/i.test(uFile);
            if (isBinary) {
              const uDiff = [
                `diff --git a/${uFile} b/${uFile}`,
                "new file mode 100644",
                `Binary files /dev/null and b/${uFile} differ`,
              ].join("\n");
              diffText = diffText ? `${diffText}\n\n${uDiff}` : uDiff;
            } else {
              const content = await fs.readFile(path.resolve(repoPath, uFile), "utf-8");
              const lines = content.replace(/\r/g, "").split("\n");
              const uDiff = [
                `diff --git a/${uFile} b/${uFile}`,
                "new file mode 100644",
                "--- /dev/null",
                `+++ b/${uFile}`,
                `@@ -0,0 +1,${lines.length} @@`,
                ...lines.map((l) => `+${l}`),
              ].join("\n");
              diffText = diffText ? `${diffText}\n\n${uDiff}` : uDiff;
            }
          } catch (err: unknown) {
            logger.warn("Failed to read untracked file for diff", {
              operation: "git-diff",
              metadata: { file: uFile, error: err instanceof Error ? err.message : String(err) },
            });
          }
        }
      } catch (err: unknown) {
        logger.warn("git diff commands failed", {
          operation: "git-diff",
          metadata: { error: err instanceof Error ? err.message : String(err) },
        });
      }
    }

    const entries = await executeGitDiff(repoId, {
      ...(staged && { staged }),
      ...(filePath !== undefined && { filePath }),
    });
    response.status(200).json({
      success: true,
      diff: diffText,
      filePath,
      entries,
      files: entries.map((e) => ({ ...e, diff: e.filePath === filePath ? diffText : "" })),
    });
  } catch (error) {
    next(error);
  }
}

export async function gitBranchesHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const body = getGitRequestData(request);
    const repoId = requireString(body, "repositoryId");
    await validateRepositoryAccess(repoId);
    const branches = await executeGitBranches(repoId);
    // Return { branches: [] } so client code (data.branches || []) works correctly
    response.status(200).json({ branches, count: branches.length });
  } catch (error) {
    next(error);
  }
}

export async function gitExecuteHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const operation = request.params.operation as GitOperationType;
    const catalogEntry = GIT_OPERATION_CATALOG.find((op) => op.type === operation);
    if (!catalogEntry) throw new AppError(`Unknown git operation: ${operation}`, "VALIDATION_ERROR", 400);

    const body =
      typeof request.body === "object" && request.body !== null ? (request.body as Record<string, unknown>) : {};
    const repoId = requireString(body, "repositoryId");
    await validateRepositoryAccess(repoId);

    const args = Array.isArray(body.args) ? (body.args as string[]) : [];
    const approvalTokenStr = optionalString(body, "approvalToken");
    const result = await executeGitOperation(
      repoId,
      operation,
      args,
      approvalTokenStr !== undefined
        ? { dryRun: body.dryRun === true, approvalToken: approvalTokenStr }
        : { dryRun: body.dryRun === true },
    );

    response.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export function gitOperationCatalogHandler(_request: Request, response: Response, next: NextFunction): void {
  try {
    const catalog = GIT_OPERATION_CATALOG.map((op) => ({
      type: op.type,
      risk: op.risk,
      riskLabel: getRiskLabel(op.risk),
      command: op.command,
      description: op.description,
      requiresApproval: op.requiresApproval,
      dryRunSupported: op.dryRunSupported,
    }));
    response.status(200).json(catalog);
  } catch (error) {
    next(error);
  }
}

export function gitClassifyHandler(request: Request, response: Response, next: NextFunction): void {
  try {
    const op = classifyOperation(request.params.operation as GitOperationType);
    response.status(200).json({
      type: op.type,
      risk: op.risk,
      riskLabel: getRiskLabel(op.risk),
      requiresApproval: op.requiresApproval,
      dryRunSupported: op.dryRunSupported,
      description: op.description,
    });
  } catch (error) {
    next(error);
  }
}

export async function gitAnalyzeChangesHandler(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = getGitRequestData(request);
    const repoId = optionalString(body, "repositoryId") || "default";
    let plan;
    if (Array.isArray(body.changedFiles) && body.changedFiles.length > 0) {
      plan = await planFromChangedFiles(body.changedFiles as ChangedFileDetail[]);
    } else {
      plan = await analyzeAndPlanCommits(getExecutionPath(repoId));
    }
    response.status(200).json({
      success: true,
      plan,
      summary: plan.summary,
      totalFiles: plan.totalFiles,
      totalCommits: plan.totalCommits,
      groups: plan.groups,
      changedFiles: plan.changedFiles,
    });
  } catch (error) {
    next(error);
  }
}

export async function gitExecuteCommitPlanHandler(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = getGitRequestData(request);
    const repoId = requireString(body, "repositoryId");
    const repoPath = getExecutionPath(repoId);
    let groups: LogicalChangeGroup[] | undefined = Array.isArray(body.groups)
      ? (body.groups as LogicalChangeGroup[])
      : undefined;

    if (!groups || groups.length === 0) {
      const plan = await analyzeAndPlanCommits(repoPath);
      groups = plan.groups;
    }

    if (!groups || groups.length === 0) {
      response
        .status(200)
        .json({ success: false, message: "No change groups to commit.", commits: [], totalCreated: 0 });
      return;
    }

    const result = await executeCommitPlan(repoPath, groups);
    response.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    next(error);
  }
}

export async function gitSyncHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const body = getGitRequestData(request);
    const repoId = requireString(body, "repositoryId");
    const repoPath = getExecutionPath(repoId);
    const remote = optionalString(body, "remote") ? validateRemoteName(body.remote as string) : "origin";

    try {
      await execAsync(`git fetch ${escapeShellArg(remote)} --prune`, { cwd: repoPath, timeout: 45_000 });
    } catch (err: unknown) {
      const error = err as { message?: string };
      logger.warn("git sync fetch warning", { operation: "git-sync", metadata: { error: error.message, remote } });
    }

    const status = await executeGitStatus(repoId);
    let actionRequired: "none" | "push" | "pull" | "diverged" | "commit_required" = "none";
    let message = "Repository is in sync with remote.";

    if (!status.clean) {
      actionRequired = "commit_required";
      message = "Uncommitted local changes present. Commit or stash before syncing.";
    } else if (status.ahead > 0 && status.behind > 0) {
      actionRequired = "diverged";
      message = `Branches have diverged (${status.ahead} ahead, ${status.behind} behind). Rebase or merge required.`;
    } else if (status.behind > 0) {
      actionRequired = "pull";
      try {
        const { stdout } = await execAsync(`git pull ${escapeShellArg(remote)}`, { cwd: repoPath, timeout: 60_000 });
        message = `Successfully pulled remote changes. ${stdout.trim()}`;
        actionRequired = "none";
      } catch (pullErr: unknown) {
        const error = pullErr as { message?: string };
        message = `Pull encountered conflicts or issues: ${error.message}`;
      }
    } else if (status.ahead > 0) {
      actionRequired = "push";
      message = `Local branch is ${status.ahead} commit(s) ahead of remote. Ready to push.`;
    }

    const updatedStatus = await executeGitStatus(repoId);
    response.status(200).json({
      success: true,
      branch: updatedStatus.branch,
      ahead: updatedStatus.ahead,
      behind: updatedStatus.behind,
      clean: updatedStatus.clean,
      actionRequired,
      message,
    });
  } catch (error) {
    next(error);
  }
}

export async function gitShipHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const body = getGitRequestData(request);
    const repoId = requireString(body, "repositoryId");
    const repoPath = getExecutionPath(repoId);
    const targetBranch = optionalString(body, "targetBranch") ?? "main";
    const prTitle = optionalString(body, "prTitle");
    const plan = await analyzeAndPlanCommits(repoPath);

    if (plan.groups.length === 0) {
      const status = await executeGitStatus(repoId);
      if (status.ahead === 0) {
        response.status(200).json({ success: false, message: "No changes to ship and working tree is in sync." });
        return;
      }
    }

    let commitResult = {
      success: true,
      commits: [] as Array<{ commitHash: string; commitMessage: string; files: string[] }>,
      totalCreated: 0,
    };
    if (plan.groups.length > 0) {
      const execRes = await executeCommitPlan(repoPath, plan.groups);
      if (!execRes.success) {
        response
          .status(400)
          .json({ success: false, message: `Commit step failed: ${execRes.message}`, error: execRes.error });
        return;
      }
      commitResult = execRes;
    }

    const userId =
      request.tenantContext?.userId ?? (request as unknown as { user?: { id?: string } }).user?.id ?? "user-default";
    const explicitToken = optionalString(body, "gitHubToken");
    const token = explicitToken ?? getGitHubToken(userId);

    const pushResult = await executeSafePush(repoPath, {
      setUpstream: true,
      ...(token ? { gitHubToken: token } : {}),
    });
    if (!pushResult.success) {
      response.status(400).json({
        success: false,
        message: `Push step failed: ${pushResult.error ?? pushResult.output ?? "Unknown push error"}`,
        error: pushResult.error,
        commits: commitResult.commits,
      });
      return;
    }

    const branchStatus = await executeGitStatus(repoId);
    const sourceBranch = branchStatus.branch;
    let prData: { id: number; number: number; url: string; title: string } | null = null;
    let owner = optionalString(body, "owner") ?? "";
    let repoName = optionalString(body, "repo") ?? "";

    if (!owner || !repoName) {
      try {
        const { stdout: remoteUrl } = await execAsync("git remote get-url origin", { cwd: repoPath, timeout: 10000 });
        const match = /github\.com[/:]([^/]+)\/([^/.]+)/.exec(remoteUrl.trim());
        if (match?.[1] && match[2]) {
          owner = match[1];
          repoName = match[2];
        }
      } catch (err: unknown) {
        logger.warn("Failed to get remote URL", {
          operation: "git-ship",
          metadata: { error: err instanceof Error ? err.message : String(err) },
        });
      }
    }

    if (token && owner && repoName && sourceBranch !== targetBranch) {
      try {
        const title = prTitle || commitResult.commits[0]?.commitMessage || `feat: ship updates on ${sourceBranch}`;
        const prBody = `### AI Ship Automated Pull Request\n\n**Source Branch:** \`${sourceBranch}\`\n**Target Branch:** \`${targetBranch}\`\n\n#### Commits Included (${commitResult.commits.length}):\n${commitResult.commits.map((c) => `- \`${c.commitHash}\`: ${c.commitMessage} (${c.files.length} files)`).join("\n")}\n\n*Verified and shipped automatically by AI Git Debugging Agent.*`;
        const pr = await createGitHubPR(userId, owner, repoName, {
          title,
          body: prBody,
          head: sourceBranch,
          base: targetBranch,
        });
        prData = { id: pr.id, number: pr.number, url: pr.htmlUrl, title: pr.title };
      } catch (prErr: unknown) {
        logger.warn("PR creation failed", {
          operation: "git-ship",
          metadata: { error: prErr instanceof Error ? prErr.message : String(prErr) },
        });
      }
    }

    response.status(200).json({
      success: true,
      message: `Shipped successfully: ${commitResult.totalCreated} commit(s) pushed on '${sourceBranch}'.${prData ? ` PR #${prData.number} created.` : ""}`,
      branch: sourceBranch,
      commits: commitResult.commits,
      pushed: true,
      pr: prData,
    });
  } catch (error) {
    next(error);
  }
}

export async function generateCommitMessageHandler(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = getGitRequestData(request);
    const repoId = requireString(body, "repositoryId");
    const status = await executeGitStatus(repoId);
    const statusAny = status as unknown as Record<string, unknown[]>;
    const changedFiles: unknown[] = [
      ...((status.entries ?? []) as readonly unknown[]),
      ...(statusAny.staged ?? []),
      ...(statusAny.unstaged ?? []),
      ...(statusAny.untracked ?? []),
    ];

    if (changedFiles.length === 0) {
      response.status(200).json({
        summary: "chore: no changes detected",
        description: "",
        files: [],
        branch: (status as { branch?: string }).branch ?? "main",
      });
      return;
    }

    let diffContext = "";
    try {
      const repoPath = getExecutionPath(repoId);
      const { stdout: unstagedOut } = await execAsync("git diff", { cwd: repoPath });
      const { stdout: stagedOut } = await execAsync("git diff --cached", { cwd: repoPath });
      diffContext = [unstagedOut.trim(), stagedOut.trim()].filter(Boolean).join("\n").slice(0, 4000);
    } catch (err: unknown) {
      logger.warn("Failed to get diff context", {
        operation: "generate-commit",
        metadata: { error: err instanceof Error ? err.message : String(err) },
      });
      diffContext = changedFiles
        .map(
          (f) =>
            `- ${String((f as Record<string, unknown>).path ?? (f as Record<string, unknown>).filePath ?? f)} (${String(((f as Record<string, unknown>).status as string) ?? "modified")})`,
        )
        .join("\n");
    }

    const fileList = changedFiles
      .map((f) => {
        const fo = f as Record<string, unknown>;
        return `${String((fo.status as string) ?? "modified")}: ${String(fo.path ?? fo.filePath ?? f)}`;
      })
      .join("\n");
    const instructions = `You are a Principal Software Engineer. Write a production-ready, professional Conventional Commit message for these git changes.\n\nStrict Rules:\n1. Format: <type>(<scope>): <clear, concise, imperative summary of what was actually changed/added/fixed>\n2. Types: feat, fix, chore, refactor, style, docs, test, ci, perf, build\n3. The summary line must be <= 72 characters, describing the concrete capability or bug fix (NEVER generic phrases like "update files" or "work in progress").\n4. The description must have 2 to 6 detailed bullet points starting with "- ", explaining:\n   - What architectural changes or capabilities were introduced\n   - Which specific files and components were modified and why\n   - Any UX, API, or bug fix enhancements\n5. Output ONLY valid JSON matching this exact structure:\n{"summary": "feat(scope): concise summary", "description": "- bullet 1\\n- bullet 2\\n- bullet 3"}`;
    const input = `Changed files:\n${fileList}\n\nGit diff (truncated):\n${diffContext}`;
    let summary = "";
    let description = "";

    try {
      const llmRes = await generateText({ instructions, input });
      const clean = llmRes.text
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "")
        .trim();
      try {
        const jsonMatch = /\{[\s\S]*\}/.exec(clean);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]) as { summary?: string; description?: string | string[] };
          if (parsed.summary && !parsed.summary.toLowerCase().includes("update files"))
            summary = String(parsed.summary).trim();
          if (parsed.description)
            description = Array.isArray(parsed.description)
              ? parsed.description.join("\n")
              : String(parsed.description).trim();
        }
      } catch (err: unknown) {
        logger.warn("Failed to parse LLM JSON response", {
          operation: "generate-commit",
          metadata: { error: err instanceof Error ? err.message : String(err) },
        });
        const summaryMatch = /"summary"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/.exec(clean);
        if (summaryMatch?.[1] && !summaryMatch[1].toLowerCase().includes("update files"))
          summary = summaryMatch[1].replace(/\\"/g, '"').trim();
        const descMatch = /"description"\s*:\s*"([\s\S]*?)"\s*\}/.exec(clean);
        if (descMatch?.[1])
          description = descMatch[1]
            .replace(/\\n/g, "\n")
            .replace(/\\"/g, '"')
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean)
            .join("\n");
      }
      if (!summary) {
        const lines = clean
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => !l.startsWith("```") && l);
        for (const line of lines) {
          if (/^(feat|fix|chore|refactor|style|docs|test|ci|perf|build)(\([^)]+\))?:/.test(line)) {
            summary = line;
            break;
          }
        }
        if (!summary && lines.length > 0) summary = lines[0] ?? "";
        if (!description) description = lines.filter((l) => l.startsWith("-") || l.startsWith("*")).join("\n");
      }
    } catch (err: unknown) {
      logger.warn("LLM call failed for commit message generation", {
        operation: "generate-commit",
        metadata: { error: err instanceof Error ? err.message : String(err) },
      });
    }

    if (!summary || (summary.toLowerCase().includes("update ") && summary.toLowerCase().includes("files"))) {
      const allPaths = changedFiles.map((f) =>
        String((f as Record<string, unknown>).path ?? (f as Record<string, unknown>).filePath ?? f),
      );
      const hasApi = allPaths.some((p) => p.includes("api/") || p.includes("api."));
      const hasFrontend = allPaths.some((p) => p.startsWith("public/") || p.includes("html") || p.includes("css"));
      const hasGit = allPaths.some((p) => p.includes("git"));
      const hasTests = allPaths.some((p) => p.includes("test"));
      const scope =
        hasFrontend && hasApi
          ? "fullstack"
          : hasFrontend
            ? "ui"
            : hasGit
              ? "git"
              : hasApi
                ? "api"
                : hasTests
                  ? "tests"
                  : "core";
      const type = hasTests ? "test" : hasFrontend || hasApi ? "feat" : "chore";
      const topComponents = allPaths
        .slice(0, 3)
        .map((p) => path.basename(p, path.extname(p)))
        .join(", ");
      summary = `${type}(${scope}): update ${topComponents}${allPaths.length > 3 ? ` and ${allPaths.length - 3} related files` : ""}`;
      description = allPaths
        .map((p) => {
          if (p.includes("api.js") || p.includes("api.ts"))
            return `- ${p}: add client API methods and backend endpoint handlers`;
          if (p.includes("app.js") || p.includes("app.ts"))
            return `- ${p}: update application state management, event listeners, and UI views`;
          if (p.includes("index.html"))
            return `- ${p}: refine layout structure, modal dialogs, and interactive action controls`;
          if (p.includes("styles.css"))
            return `- ${p}: update design tokens, diff viewer syntax styling, and responsive layout rules`;
          if (p.includes("git"))
            return `- ${p}: enhance git operation engine, branch refspec resolution, and commit planning`;
          if (p.includes("fs")) return `- ${p}: expand filesystem navigation and OS file explorer dialog integration`;
          return `- ${p}: apply component modifications and sync verified changes`;
        })
        .slice(0, 8)
        .join("\n");
    }

    response
      .status(200)
      .json({ summary, description, files: changedFiles, branch: (status as { branch?: string }).branch ?? "main" });
  } catch (error) {
    next(error);
  }
}

/** Stash current changes (git stash push -m <message>) */
export async function gitStashHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const body = getGitRequestData(request);
    const repoId = requireString(body, "repositoryId");
    await validateRepositoryAccess(repoId);
    const message = optionalString(body, "message");
    const result = await executeGitStashPush(repoId, message);
    const latest = await executeGitStatus(repoId).catch(() => null);
    response.status(200).json({ ...result, status: latest });
  } catch (error) {
    next(error);
  }
}

/** Pop a stash (git stash pop stash@{idx}) */
export async function gitStashPopHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const body = getGitRequestData(request);
    const repoId = requireString(body, "repositoryId");
    await validateRepositoryAccess(repoId);
    const index = typeof body.index === "number" ? body.index : 0;
    const result = await executeGitStashPop(repoId, index);
    const latest = await executeGitStatus(repoId).catch(() => null);
    response.status(200).json({ ...result, status: latest });
  } catch (error) {
    next(error);
  }
}

/** Drop a stash (git stash drop stash@{idx}) */
export async function gitStashDropHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const body = getGitRequestData(request);
    const repoId = requireString(body, "repositoryId");
    await validateRepositoryAccess(repoId);
    const index = typeof body.index === "number" ? body.index : 0;
    const result = await executeGitStashDrop(repoId, index);
    const stashes = await executeGitStashList(repoId);
    response.status(200).json({ ...result, stashes });
  } catch (error) {
    next(error);
  }
}

/** List stashes (git stash list) */
export async function gitStashListHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const body = getGitRequestData(request);
    const repoId = requireString(body, "repositoryId");
    await validateRepositoryAccess(repoId);
    const stashes = await executeGitStashList(repoId);
    response.status(200).json({ stashes, count: stashes.length });
  } catch (error) {
    next(error);
  }
}

/** Show stash diff (git stash show -p stash@{idx}) */
export async function gitStashDiffHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const body = getGitRequestData(request);
    const repoId = requireString(body, "repositoryId");
    await validateRepositoryAccess(repoId);
    const index = typeof body.index === "number" ? body.index : 0;
    const diff = await executeGitStashShow(repoId, index);
    response.status(200).json({ diff, index });
  } catch (error) {
    next(error);
  }
}

/** Stage a single diff hunk via git apply --cached */
export async function gitStageHunkHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const body = getGitRequestData(request);
    const repoId = requireString(body, "repositoryId");
    const patch = requireString(body, "patch");
    await validateRepositoryAccess(repoId);
    const result = await executeGitApplyHunk(repoId, patch, false);
    const latest = await executeGitStatus(repoId).catch(() => null);
    response.status(200).json({ ...result, status: latest });
  } catch (error) {
    next(error);
  }
}

/** Discard a single diff hunk via git apply --reverse */
export async function gitDiscardHunkHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const body = getGitRequestData(request);
    const repoId = requireString(body, "repositoryId");
    const patch = requireString(body, "patch");
    await validateRepositoryAccess(repoId);
    const result = await executeGitApplyHunk(repoId, patch, true);
    const latest = await executeGitStatus(repoId).catch(() => null);
    response.status(200).json({ ...result, status: latest });
  } catch (error) {
    next(error);
  }
}

/** Discard changes in a file (git restore <file>) */
export async function gitDiscardFileHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const body = getGitRequestData(request);
    const repoId = requireString(body, "repositoryId");
    const filePath = requireString(body, "filePath");
    const staged = body.staged === true;
    await validateRepositoryAccess(repoId);
    const result = await executeGitDiscardFile(repoId, filePath, staged);
    const latest = await executeGitStatus(repoId).catch(() => null);
    response.status(200).json({ ...result, status: latest });
  } catch (error) {
    next(error);
  }
}

/** Undo the last commit (git reset --soft HEAD~1) */
export async function gitUndoCommitHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const body = getGitRequestData(request);
    const repoId = requireString(body, "repositoryId");
    const force = body.force === true;
    await validateRepositoryAccess(repoId);
    const result = await executeGitUndoCommit(repoId, force);
    const latest = await executeGitStatus(repoId).catch(() => null);
    response.status(200).json({ ...result, status: latest });
  } catch (error) {
    next(error);
  }
}

/** Visual DAG graph nodes (git log --graph) */
export async function gitLogGraphHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const body = getGitRequestData(request);
    const repoId = requireString(body, "repositoryId");
    await validateRepositoryAccess(repoId);
    const parsedLimit =
      typeof body.limit === "number" ? body.limit : typeof body.limit === "string" ? parseInt(body.limit, 10) : 50;
    const limit = isNaN(parsedLimit) ? 50 : parsedLimit;
    const nodes = await executeGitLogGraph(repoId, limit);
    response.status(200).json({ nodes, count: nodes.length });
  } catch (error) {
    next(error);
  }
}

/** Scan changed files or text for leaked secrets */
export async function gitScanSecretsHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const body = getGitRequestData(request);
    const content = optionalString(body, "content");
    const filePath = optionalString(body, "filePath");
    const repoId = optionalString(body, "repositoryId");

    if (content) {
      const scan = scanContentForSecrets(content, filePath);
      response.status(200).json(scan);
      return;
    }

    if (repoId) {
      await validateRepositoryAccess(repoId);
      const repoPath = getExecutionPath(repoId);
      const { stdout: patch } = await execAsync("git diff", { cwd: repoPath, maxBuffer: 10 * 1024 * 1024 });
      if (!patch?.trim()) {
        response.status(200).json({ clean: true, matches: [] });
        return;
      }
      const diff = await executeGitDiff(repoId);
      const filePaths = diff.map((e) => e.filePath);
      const allMatches = [];
      for (const fp of filePaths) {
        const scan = scanContentForSecrets(patch, fp);
        if (!scan.clean) allMatches.push(...scan.matches);
      }
      if (allMatches.length === 0) {
        const fullScan = scanContentForSecrets(patch);
        if (!fullScan.clean) allMatches.push(...fullScan.matches);
      }
      response.status(200).json({ clean: allMatches.length === 0, matches: allMatches });
      return;
    }

    throw new AppError("Either content or repositoryId is required for secret scanning", "VALIDATION_ERROR", 400);
  } catch (error) {
    next(error);
  }
}

/** Delete a local branch (git branch -d <branch>) */
export async function gitDeleteBranchHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const body = getGitRequestData(request);
    const repoId = requireString(body, "repositoryId");
    const rawBranch = optionalString(body, "branch");
    if (!rawBranch) throw new AppError("branch is required", "VALIDATION_ERROR", 400);
    const branch = validateBranchName(rawBranch);
    const force = body.force === true;
    const repoPath = getExecutionPath(repoId);
    const flag = force ? "-D" : "-d";
    const result = await executeGitCommand(`git branch ${flag} ${escapeShellArg(branch)}`, repoPath);
    const latest = await executeGitStatus(repoId).catch(() => null);
    response.status(200).json({ ...result, branch, status: latest });
  } catch (error) {
    next(error);
  }
}
