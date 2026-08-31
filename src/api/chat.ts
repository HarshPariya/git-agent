import type { NextFunction, Request, Response } from "express";

import { createAgent } from "../agent/orchestrator.js";
import { ConversationMemory } from "../agent/memory.js";
import { AppError } from "../errors/app-error.js";
import { groqProvider } from "../llm/client.js";
import { CodeRetriever } from "../retrieval/retriever.js";
import { MockRetriever } from "../retrieval/mock-retriever.js";

interface ChatBody {
  readonly tenantId?: unknown;
  readonly message?: unknown;
  readonly sessionId?: unknown;
  readonly documentIds?: unknown;
  readonly retrievalMode?: unknown;
}

import { UnifiedRetriever } from "../retrieval/unified-retriever.js";
import { routeQuery } from "../agent/retrieval-router.js";

const codeRetriever = new CodeRetriever(process.cwd());
const unifiedRetriever = new UnifiedRetriever(codeRetriever);
let isRetrieverInitialized = false;

const memory = new ConversationMemory();

async function getAgent() {
  if (!isRetrieverInitialized) {
    try {
      await codeRetriever.initialize();
      isRetrieverInitialized = true;
    } catch (err) {
      console.warn("⚠️ Failed to initialize CodeRetriever, using fallback:", err);
    }
  }
  return createAgent(
    memory,
    isRetrieverInitialized ? unifiedRetriever : new MockRetriever(),
    groqProvider,
  );
}

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
    const tenantId =
      body.tenantId !== undefined && body.tenantId !== null
        ? getString(body.tenantId, "Tenant ID")
        : "default-tenant";
    const message = getString(body.message, "Message");
    const sessionId =
      body.sessionId !== undefined && body.sessionId !== null
        ? getString(body.sessionId, "Session ID")
        : "default-session";

    const documentIds =
      Array.isArray(body.documentIds) && body.documentIds.every((id: unknown) => typeof id === "string")
        ? (body.documentIds as string[])
        : undefined;

    const route = routeQuery({
      query: message,
      hasUploadedDocuments: Boolean(documentIds?.length),
      ...(documentIds !== undefined && { documentIds }),
    });

    console.log(
      `[ROUTER] query="${message}" mode=${route.mode} reason="${route.reason}" selectedDocumentIds=${JSON.stringify(documentIds || [])}`,
    );

    const agent = await getAgent();
    const result = await agent.run({
      tenantId,
      sessionId,
      question: message,
      ...(documentIds !== undefined && { documentIds }),
      retrievalMode: route.mode,
    });

    response.status(200).json({
      content: result.text,
      message: result.text,
      model: result.model,
      responseId: result.responseId,
      sources: result.sources,
    });
  } catch (error) {
    next(error);
  }
}
