import cors from "cors";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { healthHandler, readinessHandler } from "./api/health.js";
import { registerHandler, loginHandler, meHandler } from "./api/auth.js";
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
import { runBisectHandler, detectRegressionHandler } from "./api/bisect.js";
import {
  listCiBuildsHandler,
  getCiBuildHandler,
  triggerCiBuildHandler,
  getCiBuildLogsHandler,
} from "./api/ci.js";
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
import {
  browseFilesystemHandler,
  resolveFolderHandler,
  pickNativeDialogHandler,
} from "./api/fs.js";

export const app = express();

app.disable("x-powered-by");

app.use(
  cors({
    origin:
      env.nodeEnv === "production"
        ? (process.env.CORS_ORIGIN?.split(",").map((origin) => origin.trim()).filter(Boolean) ?? [])
        : true,
  }),
);
app.use(requestIdMiddleware);
app.use(express.json({ limit: "50mb" }));
app.use(
  express.raw({
    limit: "50mb",
    type: [
      "text/plain",
      "text/markdown",
      "application/octet-stream",
    ],
  }),
);

const SVG_FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#1a56db"/><stop offset="100%" stop-color="#0ea5e9"/></linearGradient></defs><circle cx="50" cy="50" r="48" fill="url(#g)"/><path d="M30 50 L45 35 L70 35 L70 65 L45 65 L30 50Z" fill="white" opacity="0.9"/><circle cx="50" cy="50" r="6" fill="url(#g)"/><line x1="50" y1="25" x2="50" y2="40" stroke="white" stroke-width="3" stroke-linecap="round"/><line x1="50" y1="60" x2="50" y2="75" stroke="white" stroke-width="3" stroke-linecap="round"/></svg>`;

app.get("/favicon.ico", (_request, response) => {
  response.setHeader("Content-Type", "image/svg+xml");
  response.setHeader("Cache-Control", "public, max-age=86400");
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
app.get("/info", (_req, res) => res.json({ service: "Git Debugging Agent", version: "2.0.0", environment: process.env.NODE_ENV || "development", status: "operational" }));
app.get("/api/info", (_req, res) => res.json({ service: "Git Debugging Agent", version: "2.0.0", environment: process.env.NODE_ENV || "development", status: "operational" }));

// Authentication
app.post("/api/auth/register", registerHandler);
app.post("/api/auth/login", loginHandler);
app.get("/api/auth/me", securityMiddleware, meHandler);

// Git repositories
app.get("/api/repositories", securityMiddleware, listRepositoriesHandler);
app.get("/api/repositories/list", securityMiddleware, listRepositoriesHandler);
app.get("/api/repositories/:id", securityMiddleware, getRepositoryHandler);
app.post("/api/repositories/connect", securityMiddleware, connectRepositoryHandler);
app.post("/api/repositories/:id/sync", securityMiddleware, syncRepositoryHandler);
app.post("/api/repositories/:id/disconnect", securityMiddleware, disconnectRepositoryHandler);
app.get("/api/repositories/:id/status", securityMiddleware, getRepositoryStatusHandler);
app.get("/api/repositories/:id/protected-branches", securityMiddleware, listProtectedBranchesHandler);
app.post("/api/repositories/:id/protected-branches", securityMiddleware, addProtectedBranchHandler);
app.delete("/api/repositories/:id/protected-branches/:branch", securityMiddleware, removeProtectedBranchHandler);
app.get("/api/fs/browse", securityMiddleware, browseFilesystemHandler);
app.post("/api/fs/resolve-folder", securityMiddleware, resolveFolderHandler);
app.post("/api/fs/pick-native-dialog", securityMiddleware, pickNativeDialogHandler);

// Git engine
app.get("/api/git/catalog", securityMiddleware, gitOperationCatalogHandler);
app.get("/api/git/classify/:operation", securityMiddleware, gitClassifyHandler);
app.get("/api/git/status", securityMiddleware, gitStatusHandler);
app.get("/api/git/log", securityMiddleware, gitLogHandler);
app.get("/api/git/diff", securityMiddleware, gitDiffHandler);
app.get("/api/git/branches", securityMiddleware, gitBranchesHandler);
app.get("/api/git/conflicts", securityMiddleware, gitConflictsHandler);
app.post("/api/git/conflicts", securityMiddleware, gitConflictsHandler);
app.post("/api/git/conflicts/resolve", securityMiddleware, gitConflictResolveHandler);
app.post("/api/git/commit", securityMiddleware, gitCommitHandler);
app.post("/api/git/push", securityMiddleware, gitPushHandler);
app.post("/api/git/pull", securityMiddleware, gitPullHandler);
app.post("/api/git/fetch", securityMiddleware, gitFetchHandler);
app.post("/api/git/checkout", securityMiddleware, gitCheckoutHandler);
app.post("/api/git/status", securityMiddleware, gitStatusHandler);
app.post("/api/git/log", securityMiddleware, gitLogHandler);
app.post("/api/git/diff", securityMiddleware, gitDiffHandler);
app.post("/api/git/branches", securityMiddleware, gitBranchesHandler);
app.post("/api/git/operations/:operation", securityMiddleware, gitExecuteHandler);

// Debugging agent
app.get("/api/debug", securityMiddleware, listDebugSessionsHandler);
app.get("/api/debug/sessions", securityMiddleware, listDebugSessionsHandler);
app.get("/api/agent/runs", securityMiddleware, listAgentRunsHandler);
app.post("/api/debug", securityMiddleware, startDebugSessionHandler);
app.post("/api/debug/run", securityMiddleware, runDebugHandler);
app.post("/api/debug/run-async", securityMiddleware, runDebugAsyncHandler);
app.post("/api/debug/classify", securityMiddleware, classifyTaskHandler);
app.post("/api/debug/plan", securityMiddleware, planTaskHandler);
app.get("/api/debug/:sessionId", securityMiddleware, getDebugSessionHandler);
app.get("/api/debug/:sessionId/stream", securityMiddleware, streamSessionHandler);
app.get("/api/debug/:sessionId/findings", securityMiddleware, getSessionFindingsHandler);
app.post("/api/debug/:sessionId/steps", securityMiddleware, executeDebugStepHandler);
app.post("/api/debug/:sessionId/fix/approve", securityMiddleware, approveFixHandler);
app.post("/api/debug/:sessionId/approve", securityMiddleware, approveFixHandler);
app.post("/api/debug/:sessionId/fix/revert", securityMiddleware, revertFixHandler);
app.post("/api/debug/:sessionId/revert", securityMiddleware, revertFixHandler);
app.post("/api/debug/:sessionId/complete", securityMiddleware, completeDebugSessionHandler);
app.post("/api/debug/:sessionId/abort", securityMiddleware, abortDebugSessionHandler);

// Repository GraphRAG
app.post("/api/graphrag/index", securityMiddleware, indexRepositoryHandler);
app.get("/api/graphrag/:repositoryId/graph", securityMiddleware, getGraphHandler);
app.post("/api/graphrag/search", securityMiddleware, searchCodeHandler);
app.post("/api/graphrag/symbols", securityMiddleware, getSymbolsHandler);
app.get("/api/graphrag/:repositoryId/status", securityMiddleware, getIndexStatusHandler);
app.get("/api/knowledge", securityMiddleware, (_request, response) => {
  response.status(200).json({
    entries: [],
    message: "Knowledge is scoped to indexed repositories. Select a repository to search GraphRAG.",
  });
});

// GitHub Integration
app.post("/api/github/connect", securityMiddleware, connectGitHubHandler);
app.delete("/api/github/connect", securityMiddleware, disconnectGitHubHandler);
app.get("/api/github/status", securityMiddleware, githubStatusHandler);
app.get("/api/github/repos", securityMiddleware, listGitHubReposHandler);
app.get("/api/github/repos/:owner/:repo", securityMiddleware, getGitHubRepoHandler);
app.get("/api/github/repos/:owner/:repo/branches", securityMiddleware, listGitHubBranchesHandler);
app.get("/api/github/repos/:owner/:repo/issues", securityMiddleware, listGitHubIssuesHandler);
app.get("/api/github/repos/:owner/:repo/issues/:number", securityMiddleware, getGitHubIssueHandler);
app.get("/api/github/repos/:owner/:repo/pulls", securityMiddleware, listGitHubPRsHandler);
app.get("/api/github/repos/:owner/:repo/pulls/:number", securityMiddleware, getGitHubPRHandler);
app.post("/api/github/repos/:owner/:repo/pulls", securityMiddleware, createGitHubPRHandler);

// Engineering workflows
app.get("/api/audit", securityMiddleware, getAuditLogHandler);
app.get("/api/audit/:id", securityMiddleware, getAuditEntryHandler);
app.post("/api/bisect", securityMiddleware, runBisectHandler);
app.post("/api/regression", securityMiddleware, detectRegressionHandler);
app.get("/api/ci", securityMiddleware, listCiBuildsHandler);
app.get("/api/ci/:id", securityMiddleware, getCiBuildHandler);
app.post("/api/ci", securityMiddleware, triggerCiBuildHandler);
app.get("/api/ci/:id/logs", securityMiddleware, getCiBuildLogsHandler);
app.get("/api/pr", securityMiddleware, listPullRequestsHandler);
app.get("/api/pr/:id", securityMiddleware, getPullRequestHandler);
app.post("/api/pr", securityMiddleware, createPullRequestHandler);
app.post("/api/pr/:id/merge", securityMiddleware, mergePullRequestHandler);
app.post("/api/pr/:id/reviewers", securityMiddleware, addPrReviewerHandler);

app.use(errorHandler);

// Serve static frontend
const publicDir = process.env.PUBLIC_DIR
  ? path.resolve(process.env.PUBLIC_DIR)
  : path.resolve(process.cwd(), "public");
app.use(express.static(publicDir));
app.use((_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

export const startServer = (): void => {
  app.listen(env.port, () => {
    logger.info("Git Debugging Agent server started", {
      operation: "startup",
      metadata: {
        port: env.port,
        environment: env.nodeEnv,
      },
    });
  });
};

const currentFilePath = fileURLToPath(import.meta.url);
const executedFilePath = process.argv[1] ? path.resolve(process.argv[1]) : "";
const isDirectExecution =
  currentFilePath === executedFilePath ||
  Boolean(
    executedFilePath &&
    currentFilePath.endsWith(path.basename(executedFilePath)),
  ) ||
  process.argv.some((arg) => arg.includes("app.ts") || arg.includes("app.js"));

isDirectExecution && startServer();
