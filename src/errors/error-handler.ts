import type { NextFunction, Request, Response } from "express";

import { logger } from "../logging/logger.js";
import { AppError } from "./app-error.js";

const getLogContext = (
  request: Request,
  metadata: Readonly<Record<string, unknown>>,
) => ({
  ...(request.requestId !== undefined && {
    requestId: request.requestId,
  }),
  operation: request.path,
  metadata,
});

export const errorHandler = (
  error: unknown,
  request: Request,
  response: Response,
  _next: NextFunction,
): void => {
  if (error instanceof AppError) {
    logger.warn(
      "Application error",
      getLogContext(request, {
        code: error.code,
        statusCode: error.statusCode,
      }),
    );

    response.status(error.statusCode).json({
      error: {
        code: error.code,
        message: error.message,
      },
    });

    return;
  }

  logger.error(
    "Unhandled application error",
    getLogContext(request, {
      error: error instanceof Error ? error.message : "Unknown error",
    }),
  );

  response.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred.",
    },
  });
};
