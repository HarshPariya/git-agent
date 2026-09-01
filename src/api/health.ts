import type { Request, Response } from "express";
import { env } from "../config/env.js";
import { getDatabaseHealth } from "../db/postgres.js";
import { getRetrievalRuntimeStatus } from "../retrieval/runtime-status.js";

export const healthHandler = async (_request: Request, response: Response): Promise<void> => {
  const dbHealth = await getDatabaseHealth();
  const retrieval = getRetrievalRuntimeStatus();
  const retrievalState = retrieval.graph === "ready"
    ? (retrieval.vector === "ready" ? "ready" : "degraded")
    : retrieval.graph;

  response.status(200).json({
    status: dbHealth.status === "healthy" ? "ok" : "degraded",
    environment: env.nodeEnv,
    modules: {
      retrieval: retrievalState,
      agent: "ready",
    },
    database: {
      status: dbHealth.status,
      latencyMs: dbHealth.latencyMs,
      poolIdleConnections: dbHealth.idleConnections,
      poolTotalConnections: dbHealth.totalConnections,
      waitingCount: dbHealth.waitingCount,
    },
    retrieval: { ...retrieval, fallbackOperational: retrieval.graph === "ready" },
  });
};

export const readinessHandler = async (_request: Request, response: Response): Promise<void> => {
  const retrieval = getRetrievalRuntimeStatus();
  const ready = retrieval.graph === "ready";
  response.status(ready ? 200 : 503).json({
    status: ready ? "ready" : "not-ready",
    retrieval,
  });
};
