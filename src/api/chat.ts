import type { NextFunction, Request, Response } from "express";

import { createAgent } from "../agent/orchestrator.js";
import { ConversationMemory } from "../agent/memory.js";
import { AppError } from "../errors/app-error.js";
import { groqProvider } from "../llm/client.js";
import { MockRetriever } from "../retrieval/mock-retriever.js";

const agent = createAgent(
  new ConversationMemory(),
  new MockRetriever(),
  groqProvider,
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

    const result = await agent.run({
      tenantId: context.tenantId,
      sessionId,
      question: message,
    });

    response.status(200).json({
      message: result.text,
      model: result.model,
      responseId: result.responseId,
      sources: result.sources,
    });
  } catch (error) {
    next(error);
  }
}
