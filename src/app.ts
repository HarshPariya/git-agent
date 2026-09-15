import cors from "cors";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { healthHandler, readinessHandler } from "./api/health.js";
import { registerHandler, loginHandler, meHandlerDb, googleLoginHandler } from "./api/auth.js";
import {
  gitStatusHandler,
  gitLogHandler,
  gitDiffHandler,
  gitBranchesHandler,
  gitConflictsHandler,
  gitConflictResolveHandler,
  gitCommitHandler,
  gitPushHandler,
  gitPullHandler,
  gitFetchHandler,
  gitCheckoutHandler,
  gitExecuteHandler,
  gitOperationCatalogHandler,
  gitClassifyHandler,
  gitAnalyzeChangesHandler,
  gitExecuteCommitPlanHandler,
  gitSyncHandler,
  gitShipHandler,
  generateCommitMessageHandler,
  gitStageHandler,
  gitUnstageHandler,
  gitStageAllHandler,
  gitUnstageAllHandler,
  gitStreamStatusHandler,
  gitSyncFileHandler,
  gitSyncWorkspaceHandler,
} from "./api/git.js";
import {
  startDebugSessionHandler,
  executeDebugStepHandler,
  runDebugHandler,
  runDebugAsyncHandler,
  getDebugSessionHandler,
  listDebugSessionsHandler,
  getSessionFindingsHandler,
  completeDebugSessionHandler,
  abortDebugSessionHandler,
  listAgentRunsHandler,
  streamSessionHandler,
  classifyTaskHandler,
  planTaskHandler,
  approveFixHandler,
  revertFixHandler,
} from "./api/debug.js";
import {
  indexRepositoryHandler,
  getGraphHandler,
  searchCodeHandler,
  getSymbolsHandler,
  getIndexStatusHandler,
} from "./api/graphrag.js";
import { getAuditLogHandler, getAuditEntryHandler } from "./api/audit.js";
import { listScriptsHandler, runScriptHandler } from "./api/scripts.js";
import { runBisectHandler, detectRegressionHandler } from "./api/bisect.js";
import { listCiBuildsHandler, getCiBuildHandler, triggerCiBuildHandler, getCiBuildLogsHandler } from "./api/ci.js";
import {
  listPullRequestsHandler,
  getPullRequestHandler,
  createPullRequestHandler,
  mergePullRequestHandler,
  addPrReviewerHandler,
} from "./api/pr.js";
import {
  connectGitHubHandler,
  disconnectGitHubHandler,
  githubStatusHandler,
  listGitHubReposHandler,
  getGitHubRepoHandler,
  listGitHubBranchesHandler,
  listGitHubIssuesHandler,
  getGitHubIssueHandler,
  listGitHubPRsHandler,
  getGitHubPRHandler,
  createGitHubPRHandler,
} from "./api/github.js";
import { env } from "./config/env.js";
import { errorHandler } from "./errors/error-handler.js";
import { logger } from "./logging/logger.js";
import { requestIdMiddleware } from "./middleware/request-id.js";
import { securityMiddleware } from "./middleware/security.js";
import { activityMiddleware } from "./middleware/activity-middleware.js";
import { ensureActivityIndexes, getUserActivity } from "./logging/activity-logger.js";
import { verifySessionToken } from "./security/auth.js";
import {
  listRepositoriesHandler,
  getRepositoryHandler,
  connectRepositoryHandler,
  syncRepositoryHandler,
  disconnectRepositoryHandler,
  getRepositoryStatusHandler,
  listProtectedBranchesHandler,
  addProtectedBranchHandler,
  removeProtectedBranchHandler,
} from "./api/repositories/index.js";
import { browseFilesystemHandler, resolveFolderHandler, pickNativeDialogHandler, openInOsHandler } from "./api/fs.js";
import {
  listUsersHandler,
  allActivityHandler,
  userActivityHandler,
  activityStatsHandler,
  userDataHandler,
  aggregateStatsHandler,
} from "./api/admin.js";

export const app = express();

app.disable("x-powered-by");

// Combined middleware: security check → activity logging → handler
// activityMiddleware runs AFTER securityMiddleware so tenantContext is available
const protectedRoute = [securityMiddleware, activityMiddleware] as const;

const allowedCorsOrigins = (process.env.CORS_ORIGIN || "*")
  .split(",")
  .map((origin) => origin.trim().replace(/\/$/, ""))
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // In non-production or for server-to-server / curl / same-origin without Origin header
      if (!origin || env.nodeEnv !== "production") {
        return callback(null, true);
      }
      const normalized = origin.replace(/\/$/, "");
      if (allowedCorsOrigins.includes("*") || allowedCorsOrigins.includes(normalized)) {
        return callback(null, true);
      }
      return callback(new Error(`CORS blocked: Origin ${origin} is not in CORS_ORIGIN allowlist`));
    },
    credentials: true,
  }),
);
app.use(requestIdMiddleware);
app.use(express.json({ limit: "1mb" }));
app.use(
  express.raw({
    limit: "1mb",
    type: ["text/plain", "text/markdown", "application/octet-stream"],
  }),
);

const SVG_FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#1f2937"/><stop offset="100%" stop-color="#000000"/></linearGradient></defs><rect x="8" y="8" width="84" height="84" rx="20" fill="url(#g)"/><polyline points="30,55 42,44 30,33" fill="none" stroke="white" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" opacity="0.95"/><line x1="46" y1="55" x2="68" y2="55" stroke="white" stroke-width="5" stroke-linecap="round" opacity="0.95"/></svg>`;

app.get("/favicon.ico", (_request, response) => {
  response.setHeader("Content-Type", "image/svg+xml");
  response.setHeader("Cache-Control", "no-cache");
  response.status(200).send(SVG_FAVICON);
});

app.get("/api/info", (_request, response) => {
  response.status(200).json({
    status: "ok",
    service: "Git Debugging Agent",
    version: "2.0.0",
    environment: env.nodeEnv,
    endpoints: {
      health: "GET /health",
      readiness: "GET /ready",
      git: {
        status: "GET|POST /api/git/status",
        log: "GET|POST /api/git/log",
        diff: "GET|POST /api/git/diff",
        branches: "GET|POST /api/git/branches",
        operations: "POST /api/git/operations/:operation",
      },
      debugging: {
        sessions: "GET|POST /api/debug",
        run: "POST /api/debug/run",
        session: "GET /api/debug/:sessionId",
        findings: "GET /api/debug/:sessionId/findings",
      },
      graphrag: {
        index: "POST /api/graphrag/index",
        search: "POST /api/graphrag/search",
        graph: "GET /api/graphrag/:repositoryId/graph",
      },
      scripts: {
        list: "GET /api/scripts",
        run: "POST /api/scripts/run",
      },
      github: {
        connect: "POST /api/github/connect",
        status: "GET /api/github/status",
        repos: "GET /api/github/repos",
        issues: "GET /api/github/repos/:owner/:repo/issues",
        prs: "GET /api/github/repos/:owner/:repo/pulls",
      },
      auth: {
        register: "POST /api/auth/register",
        login: "POST /api/auth/login",
        me: "GET /api/auth/me",
      },
    },
  });
});

// System & Health
app.get("/health", healthHandler);
app.get("/ready", readinessHandler);
app.get("/readiness", readinessHandler);
app.get("/info", (_req, res) =>
  res.json({
    service: "Git Debugging Agent",
    version: "2.0.0",
    environment: process.env.NODE_ENV || "development",
    status: "operational",
  }),
);

// Authentication
app.post("/api/auth/register", registerHandler);
app.post("/api/auth/login", loginHandler);
app.post("/api/auth/google", googleLoginHandler);
app.get("/api/auth/me", ...protectedRoute, meHandlerDb);
app.get("/api/auth/google-client-id", (_req, res) => {
  res.json({ clientId: process.env.GOOGLE_CLIENT_ID?.trim() || "" });
});

// Git repositories
app.get("/api/repositories", ...protectedRoute, listRepositoriesHandler);
app.get("/api/repositories/list", ...protectedRoute, listRepositoriesHandler);
app.get("/api/repositories/:id", ...protectedRoute, getRepositoryHandler);
app.post("/api/repositories", ...protectedRoute, connectRepositoryHandler);
app.post("/api/repositories/connect", ...protectedRoute, connectRepositoryHandler);
app.post("/api/repositories/:id/sync", ...protectedRoute, syncRepositoryHandler);
app.post("/api/repositories/:id/disconnect", ...protectedRoute, disconnectRepositoryHandler);
app.get("/api/repositories/:id/status", ...protectedRoute, getRepositoryStatusHandler);
app.get("/api/repositories/:id/protected-branches", ...protectedRoute, listProtectedBranchesHandler);
app.post("/api/repositories/:id/protected-branches", ...protectedRoute, addProtectedBranchHandler);
app.delete("/api/repositories/:id/protected-branches/:branch", ...protectedRoute, removeProtectedBranchHandler);
app.get("/api/fs/browse", ...protectedRoute, browseFilesystemHandler);
app.post("/api/fs/resolve-folder", ...protectedRoute, resolveFolderHandler);
app.post("/api/fs/pick-native-dialog", ...protectedRoute, pickNativeDialogHandler);
app.post("/api/fs/open-in-os", ...protectedRoute, openInOsHandler);

// Git engine
app.get("/api/git/catalog", ...protectedRoute, gitOperationCatalogHandler);
app.get("/api/git/classify/:operation", ...protectedRoute, gitClassifyHandler);
app.get("/api/git/status", ...protectedRoute, gitStatusHandler);
app.get("/api/git/stream/:repositoryId", ...protectedRoute, gitStreamStatusHandler);
app.get("/api/git/:repositoryId/stream", ...protectedRoute, gitStreamStatusHandler);
app.get("/api/git/stream", ...protectedRoute, gitStreamStatusHandler);
app.get("/api/git/log", ...protectedRoute, gitLogHandler);
app.get("/api/git/diff", ...protectedRoute, gitDiffHandler);
app.get("/api/git/branches", ...protectedRoute, gitBranchesHandler);
app.get("/api/git/conflicts", ...protectedRoute, gitConflictsHandler);
app.post("/api/git/conflicts", ...protectedRoute, gitConflictsHandler);
app.post("/api/git/conflicts/resolve", ...protectedRoute, gitConflictResolveHandler);
app.post("/api/git/conflict/resolve", ...protectedRoute, gitConflictResolveHandler);
app.post("/api/git/commit", ...protectedRoute, gitCommitHandler);
app.post("/api/git/stage", ...protectedRoute, gitStageHandler);
app.post("/api/git/unstage", ...protectedRoute, gitUnstageHandler);
app.post("/api/git/stage-all", ...protectedRoute, gitStageAllHandler);
app.post("/api/git/unstage-all", ...protectedRoute, gitUnstageAllHandler);
app.post("/api/git/sync-file", ...protectedRoute, gitSyncFileHandler);
app.post("/api/git/sync-workspace", ...protectedRoute, gitSyncWorkspaceHandler);
app.post("/api/git/push", ...protectedRoute, gitPushHandler);
app.post("/api/git/pull", ...protectedRoute, gitPullHandler);
app.post("/api/git/fetch", ...protectedRoute, gitFetchHandler);
app.post("/api/git/checkout", ...protectedRoute, gitCheckoutHandler);
app.post("/api/git/status", ...protectedRoute, gitStatusHandler);
app.post("/api/git/log", ...protectedRoute, gitLogHandler);
app.post("/api/git/diff", ...protectedRoute, gitDiffHandler);
app.post("/api/git/branches", ...protectedRoute, gitBranchesHandler);
app.post("/api/git/operations/:operation", ...protectedRoute, gitExecuteHandler);
app.post("/api/git/analyze-changes", ...protectedRoute, gitAnalyzeChangesHandler);
app.post("/api/git/commit-plan/execute", ...protectedRoute, gitExecuteCommitPlanHandler);
app.post("/api/git/commit-all", ...protectedRoute, gitExecuteCommitPlanHandler);
app.post("/api/git/sync", ...protectedRoute, gitSyncHandler);
app.post("/api/git/ship", ...protectedRoute, gitShipHandler);
app.post("/api/git/generate-commit-message", ...protectedRoute, generateCommitMessageHandler);

// Debugging agent
app.get("/api/debug", ...protectedRoute, listDebugSessionsHandler);
app.get("/api/debug/sessions", ...protectedRoute, listDebugSessionsHandler);
app.get("/api/agent/runs", ...protectedRoute, listAgentRunsHandler);
app.post("/api/debug", ...protectedRoute, startDebugSessionHandler);
app.post("/api/debug/start", ...protectedRoute, startDebugSessionHandler);
app.post("/api/debug/run", ...protectedRoute, runDebugHandler);
app.post("/api/debug/run-async", ...protectedRoute, runDebugAsyncHandler);
app.post("/api/debug/classify", ...protectedRoute, classifyTaskHandler);
app.post("/api/debug/plan", ...protectedRoute, planTaskHandler);
app.get("/api/debug/:sessionId", ...protectedRoute, getDebugSessionHandler);
app.get("/api/debug/:sessionId/stream", ...protectedRoute, streamSessionHandler);
app.get("/api/debug/:sessionId/findings", ...protectedRoute, getSessionFindingsHandler);
app.post("/api/debug/:sessionId/steps", ...protectedRoute, executeDebugStepHandler);
app.post("/api/debug/:sessionId/step", ...protectedRoute, executeDebugStepHandler);
app.post("/api/debug/:sessionId/fix/approve", ...protectedRoute, approveFixHandler);
app.post("/api/debug/:sessionId/approve", ...protectedRoute, approveFixHandler);
app.post("/api/debug/:sessionId/fix/revert", ...protectedRoute, revertFixHandler);
app.post("/api/debug/:sessionId/revert", ...protectedRoute, revertFixHandler);
app.post("/api/debug/:sessionId/complete", ...protectedRoute, completeDebugSessionHandler);
app.post("/api/debug/:sessionId/abort", ...protectedRoute, abortDebugSessionHandler);

// Repository GraphRAG
app.post("/api/graphrag/index", ...protectedRoute, indexRepositoryHandler);
app.get("/api/graphrag/:repositoryId/graph", ...protectedRoute, getGraphHandler);
app.post("/api/graphrag/search", ...protectedRoute, searchCodeHandler);
app.post("/api/graphrag/symbols", ...protectedRoute, getSymbolsHandler);
app.get("/api/graphrag/:repositoryId/status", ...protectedRoute, getIndexStatusHandler);
app.get("/api/knowledge", ...protectedRoute, (_request, response) => {
  response.status(200).json({
    entries: [],
    message: "Knowledge is scoped to indexed repositories. Select a repository to search GraphRAG.",
  });
});

// GitHub Integration
app.post("/api/github/connect", ...protectedRoute, connectGitHubHandler);
app.delete("/api/github/connect", ...protectedRoute, disconnectGitHubHandler);
app.get("/api/github/status", ...protectedRoute, githubStatusHandler);
app.get("/api/github/repos", ...protectedRoute, listGitHubReposHandler);
app.get("/api/github/repos/:owner/:repo", ...protectedRoute, getGitHubRepoHandler);
app.get("/api/github/repos/:owner/:repo/branches", ...protectedRoute, listGitHubBranchesHandler);
app.get("/api/github/repos/:owner/:repo/issues", ...protectedRoute, listGitHubIssuesHandler);
app.get("/api/github/repos/:owner/:repo/issues/:number", ...protectedRoute, getGitHubIssueHandler);
app.get("/api/github/repos/:owner/:repo/pulls", ...protectedRoute, listGitHubPRsHandler);
app.get("/api/github/repos/:owner/:repo/pulls/:number", ...protectedRoute, getGitHubPRHandler);
app.post("/api/github/repos/:owner/:repo/pulls", ...protectedRoute, createGitHubPRHandler);

// Engineering workflows
app.get("/api/scripts", ...protectedRoute, listScriptsHandler);
app.post("/api/scripts/run", ...protectedRoute, runScriptHandler);
app.get("/api/audit", ...protectedRoute, getAuditLogHandler);
app.get("/api/audit/:id", ...protectedRoute, getAuditEntryHandler);
app.post("/api/bisect", ...protectedRoute, runBisectHandler);
app.post("/api/regression", ...protectedRoute, detectRegressionHandler);
app.get("/api/ci", ...protectedRoute, listCiBuildsHandler);
app.get("/api/ci/:id", ...protectedRoute, getCiBuildHandler);
app.post("/api/ci", ...protectedRoute, triggerCiBuildHandler);
app.get("/api/ci/:id/logs", ...protectedRoute, getCiBuildLogsHandler);
app.get("/api/pr", ...protectedRoute, listPullRequestsHandler);
app.get("/api/pr/:id", ...protectedRoute, getPullRequestHandler);
app.post("/api/pr", ...protectedRoute, createPullRequestHandler);
app.post("/api/pr/:id/merge", ...protectedRoute, mergePullRequestHandler);
app.post("/api/pr/:id/reviewers", ...protectedRoute, addPrReviewerHandler);

// Admin routes (require admin role — enforced inside each handler)
app.get("/api/admin/users", ...protectedRoute, listUsersHandler);
app.get("/api/admin/activity", ...protectedRoute, allActivityHandler);
app.get("/api/admin/activity/:userId", ...protectedRoute, userActivityHandler);
app.get("/api/admin/stats", ...protectedRoute, activityStatsHandler);
app.get("/api/admin/user-data/:userId", ...protectedRoute, userDataHandler);
app.get("/api/admin/aggregate-stats", ...protectedRoute, aggregateStatsHandler);

// User activity endpoint — any authenticated user can see their own activity
app.get("/api/user/activity", ...protectedRoute, async (request, response, next) => {
  try {
    const ctx = request.tenantContext;
    if (!ctx) {
      response.status(401).json({ error: "Authentication required" });
      return;
    }

    const authHeader = request.header("authorization")?.trim();
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : undefined;
    let userId = ctx.userId;

    // Try to extract userId from session token for accuracy
    if (token) {
      try {
        const session = verifySessionToken(token);
        userId = session.userId;
      } catch {
        // Use ctx.userId as fallback
      }
    }

    const limit = Math.min(Number(request.query.limit) || 50, 200);
    const skip = Number(request.query.skip) || 0;

    const result = await getUserActivity(userId, { limit, skip });
    response.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

app.use(errorHandler);

// Serve static frontend
const publicDir = process.env.PUBLIC_DIR ? path.resolve(process.env.PUBLIC_DIR) : path.resolve(process.cwd(), "public");
app.use(
  express.static(publicDir, {
    etag: false,
    maxAge: 0,
    setHeaders: (res) => {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
    },
  }),
);
app.use((_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

export const startServer = async (): Promise<void> => {
  // Connect to MongoDB on startup
  try {
    const { connectDatabase } = await import("./db/mongodb.js");
    await connectDatabase();
    // Create activity_history indexes for fast per-user queries
    await ensureActivityIndexes();
    // Rehydrate previously-connected repositories across restarts
    const { repositoryStore }: { repositoryStore: { hydrateFromDb(): Promise<void> } } =
      await import("./repositories/repository-store.js");
    await repositoryStore.hydrateFromDb();
    // Backfill created_at for users who signed up before the field existed
    const { backfillUserCreatedAt }: { backfillUserCreatedAt: () => Promise<void> } =
      await import("./db/persistence.js");
    await backfillUserCreatedAt();
  } catch (error) {
    logger.warn("MongoDB connection failed — continuing without database", {
      operation: "startup",
      metadata: { error: error instanceof Error ? error.message : String(error) },
    });
  }

  const server = app.listen(env.port, () => {
    logger.info("Git Debugging Agent server started", {
      operation: "startup",
      metadata: {
        port: env.port,
        environment: env.nodeEnv,
      },
    });
  });

  const gracefulShutdown = (signal: string) => {
    logger.info(`Received ${signal}. Starting graceful shutdown...`);

    const shutdownTimeout = setTimeout(() => {
      logger.error("Graceful shutdown timed out. Forcing exit.");
      process.exit(1);
    }, 10000);

    server.close(
      () =>
        void (async () => {
          logger.info("HTTP server closed.");
          try {
            const { closeDatabase } = await import("./db/mongodb.js");
            await closeDatabase();
            logger.info("Database connection closed.");
            clearTimeout(shutdownTimeout);
            process.exit(0);
          } catch (error: unknown) {
            logger.error("Error closing database", {
              operation: "graceful-shutdown",
              metadata: { error: error instanceof Error ? error.message : String(error) },
            });
            clearTimeout(shutdownTimeout);
            process.exit(1);
          }
        })(),
    );
  };

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
};

const currentFilePath = fileURLToPath(import.meta.url);
const executedFilePath = process.argv[1] ? path.resolve(process.argv[1]) : "";
const isDirectExecution =
  currentFilePath === executedFilePath ||
  Boolean(executedFilePath && currentFilePath.endsWith(path.basename(executedFilePath))) ||
  process.argv.some((arg) => arg.includes("app.ts") || arg.includes("app.js"));

if (isDirectExecution && !process.env.VERCEL) {
  startServer().catch((err) => {
    console.error("Failed to start server:", err);
    process.exit(1);
  });
}

export default app;
