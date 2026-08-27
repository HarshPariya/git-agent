import { randomUUID } from "node:crypto";

import type { RequestHandler } from "express";

export const requestIdMiddleware: RequestHandler = (
  request,
  response,
  next,
): void => {
  const requestId = request.header("x-request-id")?.trim() || randomUUID();

  response.setHeader("x-request-id", requestId);

  Object.defineProperty(request, "requestId", {
    value: requestId,
    enumerable: false,
    writable: false,
  });

  next();
};
