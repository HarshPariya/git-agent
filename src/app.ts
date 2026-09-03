import cors from "cors";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chatHandler } from "./api/chat.js";
import {
  deleteDocumentHandler,
  listDocumentsHandler,
  uploadDocumentHandler,
} from "./api/documents.js";
import { healthHandler, readinessHandler } from "./api/health.js";
import { registerHandler, loginHandler, meHandler } from "./api/auth.js";
import {
  listWorkspacesHandler,
  createWorkspaceHandler,
  getWorkspaceHandler,
  deleteWorkspaceHandler,
} from "./api/workspaces.js";
import {
  generatePairCodeHandler,
  pairDeviceHandler,
  pollJobsHandler,
  submitResultHandler,
  heartbeatHandler,
  connectorStatusHandler,
  disconnectHandler,
} from "./api/connector.js";
import {
  getWorkspaceTreeHandler,
  readWorkspaceFileHandler,
  writeWorkspaceFileHandler,
  createWorkspaceFolderHandler,
  deleteWorkspaceFileHandler,
} from "./api/workspace-files.js";
import { env } from "./config/env.js";
import { errorHandler } from "./errors/error-handler.js";
import { logger } from "./logging/logger.js";
import { requestIdMiddleware } from "./middleware/request-id.js";
import { securityMiddleware } from "./middleware/security.js";

export const app = express();

app.disable("x-powered-by");

app.use(cors());
app.use(requestIdMiddleware);
app.use(express.json({ limit: "50mb" }));
app.use(
  express.raw({
    limit: "50mb",
    type: [
      "text/plain",
      "text/markdown",
      "application/pdf",
      "application/octet-stream",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
  }),
);

const publicDir = path.resolve(process.cwd(), "public");
app.use(express.static(publicDir));

const SVG_FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#4f46e5"/><stop offset="100%" stop-color="#06b6d4"/></linearGradient></defs><circle cx="50" cy="50" r="48" fill="url(#g)"/><rect x="26" y="36" width="48" height="34" rx="8" fill="#ffffff"/><circle cx="40" cy="50" r="4.5" fill="#4f46e5"/><circle cx="60" cy="50" r="4.5" fill="#4f46e5"/><rect x="46" y="24" width="8" height="12" rx="2" fill="#ffffff"/><circle cx="50" cy="20" r="4" fill="#ffffff"/><path d="M40 60c2.5 3 7.5 4 10 4s7.5-1 10-4" stroke="#4f46e5" stroke-width="2.5" stroke-linecap="round" fill="none"/></svg>`;

app.get("/favicon.ico", (_request, response) => {
  response.setHeader("Content-Type", "image/svg+xml");
  response.setHeader("Cache-Control", "public, max-age=86400");
  response.status(200).send(SVG_FAVICON);
});

app.get("/api/info", (_request, response) => {
  response.status(200).json({
    status: "ok",
    service: "CodeGPT Enterprise Multi-Tenant Platform",
    environment: env.nodeEnv,
    endpoints: {
      health: "GET /health",
      readiness: "GET /ready",
      chat: "POST /api/chat",
      auth: {
        register: "POST /api/auth/register",
        login: "POST /api/auth/login",
        me: "GET /api/auth/me",
      },
      workspaces: {
        list: "GET /api/workspaces",
        create: "POST /api/workspaces",
        get: "GET /api/workspaces/:id",
        delete: "DELETE /api/workspaces/:id",
      },
      connector: {
        pairCode: "POST /api/connector/pair-code",
        pair: "POST /api/connector/pair",
        poll: "POST /api/connector/poll",
        executeResult: "POST /api/connector/execute-result",
        heartbeat: "POST /api/connector/heartbeat",
        status: "GET /api/connector/status/:workspaceId",
        disconnect: "POST /api/connector/disconnect",
      },
      documents: {
        upload: "POST /api/documents/upload",
        list: "GET /api/documents",
        delete: "DELETE /api/documents/:id",
      },
    },
  });
});

// System & Health
app.get("/health", healthHandler);
app.get("/ready", readinessHandler);

// Authentication
app.post("/api/auth/register", registerHandler);
app.post("/api/auth/login", loginHandler);
app.get("/api/auth/me", securityMiddleware, meHandler);

// Workspaces
app.get("/api/workspaces", securityMiddleware, listWorkspacesHandler);
app.post("/api/workspaces", securityMiddleware, createWorkspaceHandler);
app.get("/api/workspaces/:id", securityMiddleware, getWorkspaceHandler);
app.delete("/api/workspaces/:id", securityMiddleware, deleteWorkspaceHandler);

// Local Workspace Connector Bridge
app.post("/api/connector/pair-code", securityMiddleware, generatePairCodeHandler);
app.post("/api/connector/pair", pairDeviceHandler);
app.post("/api/connector/poll", pollJobsHandler);
app.post("/api/connector/execute-result", submitResultHandler);
app.post("/api/connector/heartbeat", heartbeatHandler);
app.get("/api/connector/status/:workspaceId", securityMiddleware, connectorStatusHandler);
app.post("/api/connector/disconnect", securityMiddleware, disconnectHandler);

// Chat & Autonomous Agent
app.post("/chat", securityMiddleware, chatHandler);
app.post("/api/chat", securityMiddleware, chatHandler);

// Knowledge Documents Ingestion (M1)
app.post("/api/documents/upload", securityMiddleware, uploadDocumentHandler);
app.get("/api/documents", securityMiddleware, listDocumentsHandler);
app.delete("/api/documents/:id", securityMiddleware, deleteDocumentHandler);

// Workspace Filesystem (Antigravity IDE File Sync)
app.get("/api/workspace-files/tree", securityMiddleware, getWorkspaceTreeHandler);
app.get("/api/workspace-files/read", securityMiddleware, readWorkspaceFileHandler);
app.post("/api/workspace-files/write", securityMiddleware, writeWorkspaceFileHandler);
app.post("/api/workspace-files/mkdir", securityMiddleware, createWorkspaceFolderHandler);
app.delete("/api/workspace-files/delete", securityMiddleware, deleteWorkspaceFileHandler);

app.use(errorHandler);

export const startServer = (): void => {
  app.listen(env.port, () => {
    logger.info("CodeGPT enterprise server started", {
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
  );

isDirectExecution && startServer();
