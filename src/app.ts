import path from "node:path";
import cors from "cors";
import express from "express";

import { chatHandler } from "./api/chat.js";
import { env } from "./config/env.js";
import { errorHandler } from "./errors/error-handler.js";
import { logger } from "./logging/logger.js";
import { requestIdMiddleware } from "./middleware/request-id.js";
import { getDatabaseHealth, query } from "./db/postgres.js";
import { runMigrations } from "./db/migrate.js";

import { uploadDocumentHandler, listDocumentsHandler, deleteDocumentHandler } from "./api/documents.js";

const app = express();

app.disable("x-powered-by");

app.use(cors());
app.use(requestIdMiddleware);
app.use(express.json({ limit: "1mb" }));
app.use(express.raw({ limit: "10mb", type: "*/*" }));

// Serve static frontend website files from public/
app.use(express.static(path.join(process.cwd(), "public")));

const handleHealth = async (_request: express.Request, response: express.Response) => {
  const database = await getDatabaseHealth();
  let schemaReady = false;
  if (database.status === "healthy") {
    try {
      const schema = await query<{
        code_chunks: string | null;
        documents: string | null;
        document_chunks: string | null;
      }>(`SELECT
          to_regclass('public.code_chunks')::text AS code_chunks,
          to_regclass('public.documents')::text AS documents,
          to_regclass('public.document_chunks')::text AS document_chunks`);
      const row = schema.rows[0];
      schemaReady = Boolean(row?.code_chunks && row.documents && row.document_chunks);
    } catch {
      schemaReady = false;
    }
  }
  const healthy = database.status === "healthy" && schemaReady;
  response.status(healthy ? 200 : 503).json({
    status: healthy ? "ok" : "degraded",
    environment: env.nodeEnv,
    database: {
      ...database,
      schemaReady,
      poolIdleConnections: database.idleConnections,
    },
  });
};

app.get("/health", handleHealth);
app.get("/api/health", handleHealth);

app.post("/chat", chatHandler);
app.post("/api/chat", chatHandler);

app.post("/api/documents/upload", uploadDocumentHandler);
app.get("/api/documents", listDocumentsHandler);
app.delete("/api/documents/:id", deleteDocumentHandler);

app.use(errorHandler);

async function startServer(): Promise<void> {
  if (process.env.DATABASE_URL) {
    try {
      await runMigrations();
    } catch (error) {
      if (env.nodeEnv === "production") throw error;
      logger.warn("Database migrations unavailable; using in-memory fallback", {
        operation: "startup",
        metadata: { error: error instanceof Error ? error.message : String(error) },
      });
    }
  } else {
    logger.warn("DATABASE_URL is not configured; persistence is disabled", {
      operation: "startup",
    });
  }

  app.listen(env.port, () => {
  logger.info("AI chatbot API started", {
    operation: "startup",
    metadata: {
      port: env.port,
      environment: env.nodeEnv,
    },
  });
  console.log(`\n🚀 AI Chatbot Website & API running at: http://localhost:${env.port}\n`);
  });
}

startServer().catch((error) => {
  logger.error("AI chatbot startup failed", {
    operation: "startup",
    metadata: { error: error instanceof Error ? error.message : String(error) },
  });
  process.exitCode = 1;
});
