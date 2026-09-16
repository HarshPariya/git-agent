import type { NextFunction, Request, Response } from "express";
import { logger } from "../logging/logger.js";
import { AppError } from "./app-error.js";

const getLogContext = (request: Request, metadata: Record<string, unknown>) => ({
  ...(request.requestId !== undefined && { requestId: request.requestId }),
  operation: request.path,
  metadata,
});

const extractErrorMessage = (error: unknown): string => (error instanceof Error ? error.message : "Unknown error");

export const errorHandler = (error: unknown, request: Request, response: Response, _next: NextFunction): void => {
  const isAppError = error instanceof AppError;

  let status: number;
  let code: string;
  let message: string;

  if (isAppError) {
    status = error.statusCode;
    code = error.code;
    message = error.message;
  } else if (error instanceof SyntaxError && "body" in error) {
    status = 400;
    code = "VALIDATION_ERROR";
    message = "Invalid request body";
  } else if (error instanceof Error) {
    status = 500;
    code = "INTERNAL_ERROR";
    message =
      process.env.NODE_ENV === "production"
        ? "An unexpected error occurred."
        : error.message || "An unexpected error occurred.";
  } else {
    status = 500;
    code = "INTERNAL_ERROR";
    message = "An unexpected error occurred.";
  }

  const logDetails = isAppError ? { code, statusCode: status } : { error: extractErrorMessage(error) };

  (isAppError ? logger.warn : logger.error)(
    isAppError ? "Application error" : "Unhandled application error",
    getLogContext(request, logDetails),
  );

  response.status(status).json({ error: { code, message } });
};
