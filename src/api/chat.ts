import type { NextFunction, Request, Response } from "express";

import { createAgent } from "../agent/orchestrator.js";
import { ConversationMemory } from "../agent/memory.js";
import { AppError } from "../errors/app-error.js";
import { groqProvider } from "../llm/client.js";
import { MockRetriever } from "../retrieval/mock-retriever.js";

interface ChatBody {
  readonly tenantId?: unknown;
  readonly message?: unknown;
  readonly sessionId?: unknown;
}

const agent = createAgent(
  new ConversationMemory(),
  new MockRetriever(),
  groqProvider,
);

const getBody = (body: unknown): ChatBody =>
  typeof body === "object" && body !== null ? (body as ChatBody) : {};

const getString = (value: unknown, field: string): string => {
  switch (typeof value) {
    case "string": {
      const result = value.trim();

      switch (result.length) {
        case 0:
          throw new AppError(
            `${field} must not be empty`,
            "VALIDATION_ERROR",
            400,
          );

        default:
          return result;
      }
    }

    default:
      throw new AppError(`${field} must be a string`, "VALIDATION_ERROR", 400);
  }
};

export async function chatHandler(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = getBody(request.body);
    const tenantId = getString(body.tenantId, "Tenant ID");
    const message = getString(body.message, "Message");
    const sessionId = getString(body.sessionId, "Session ID");

    const result = await agent.run({
      tenantId,
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
