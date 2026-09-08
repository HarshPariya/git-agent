import type { NextFunction, Request, Response } from "express";
import { logger } from "../logging/logger.js";
import { AppError } from "./app-error.js";

const getLogContext = (request: Request, metadata: Record<string, unknown>) => ({
  ...(request.requestId !== undefined && { requestId: request.requestId }),
  operation: request.path,
  metadata,
});

const extractErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Unknown error";

export const errorHandler = (
  error: unknown,
  request: Request,
  response: Response,
  _next: NextFunction,
): void => {
  const isAppError = error instanceof AppError;
  const status = isAppError ? error.statusCode : 500;
  const code = isAppError ? error.code : "INTERNAL_ERROR";
  const message = isAppError ? error.message : "An unexpected error occurred.";

  const logDetails = isAppError
    ? { code, statusCode: status }
    : { error: extractErrorMessage(error) };

  (isAppError ? logger.warn : logger.error)(
    isAppError ? "Application error" : "Unhandled application error",
    getLogContext(request, logDetails),
  );

  response.status(status).json({ error: { code, message } });
};
