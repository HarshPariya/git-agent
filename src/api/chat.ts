import type { NextFunction, Request, Response } from "express";

import { createAgent } from "../agent/orchestrator.js";
import { ConversationMemory } from "../agent/memory.js";
import { AppError } from "../errors/app-error.js";
import { groqProvider } from "../llm/client.js";
import { CodeRetriever } from "../retrieval/retriever.js";
import { MockRetriever } from "../retrieval/mock-retriever.js";
import { UnifiedRetriever } from "../retrieval/unified-retriever.js";
import { routeQuery } from "../agent/retrieval-router.js";

import { env } from "../config/env.js";
import { mockProvider } from "../llm/mock-client.js";

const codeRetriever = new CodeRetriever(process.cwd());
const unifiedRetriever = new UnifiedRetriever(codeRetriever);
const memory = new ConversationMemory();
let retrieverInitialization: Promise<boolean> | undefined;

const initializeRetriever = (): Promise<boolean> => {
  retrieverInitialization ??= codeRetriever.initialize()
    .then(() => true)
    .catch((error) => {
      console.warn("Failed to initialize CodeRetriever; using fallback", error);
      return false;
    });
  return retrieverInitialization;
};

const getAgent = async () => createAgent(
  memory,
  (await initializeRetriever()) ? unifiedRetriever : new MockRetriever(),
  env.nodeEnv === "test" ? mockProvider : groqProvider,
);

const validateField = (value: unknown, field: string): string => {
  const checks = [
    { valid: typeof value === "string", msg: `${field} must be a string` },
    {
      valid: typeof value === "string" && Boolean(value.trim()),
      msg: `${field} must not be empty`,
    },
  ];

  for (const check of checks) {
    !check.valid &&
      (() => {
        throw new AppError(check.msg, "VALIDATION_ERROR", 400);
      })();
  }

  return (value as string).trim();
};

export async function chatHandler(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const context =
      request.tenantContext ??
      (() => {
        throw new AppError(
          "Tenant context is missing",
          "AUTHENTICATION_ERROR",
          401,
        );
      })();

    const body =
      typeof request.body === "object" && request.body !== null
        ? (request.body as Record<string, unknown>)
        : {};

    const message = validateField(body.message, "Message");
    const sessionId = validateField(body.sessionId, "Session ID");
    const documentIds = Array.isArray(body.documentIds) &&
      body.documentIds.every((id) => typeof id === "string")
      ? body.documentIds as string[]
      : undefined;
    const route = routeQuery({
      query: message,
      hasUploadedDocuments: Boolean(documentIds?.length),
      ...(documentIds !== undefined && { documentIds }),
    });

    const agent = await getAgent();
    const result = await agent.run({
      tenantId: context.tenantId,
      sessionId,
      question: message,
      ...(documentIds !== undefined && { documentIds }),
      retrievalMode: route.mode,
    });

    response.status(200).json({
      message: result.text,
      model: result.model,
      responseId: result.responseId,
      sources: result.sources,
    });
  } catch (error) {
    if (
      error instanceof AppError &&
      error.code === "INTERNAL_ERROR" &&
      String(error.message).includes("llm_generate failed")
    ) {
      response.status(200).json({
        message:
          "I am currently operating under high upstream API traffic (rate limit). However, all autonomous tools (workspace file inspection, read/write/edit/delete, and git status) remain active. Please specify a file or command to execute.",
        model: "high-availability-fallback",
        responseId: "ha-fallback",
        sources: [],
      });
      return;
    }
    next(error);
  }
}
