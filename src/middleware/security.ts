import type { NextFunction, Request, Response } from "express";

import { authorize } from "../security/authorization.js";
import { InMemoryRateLimiter } from "../security/rate-limit.js";
import { createTenantContext } from "../security/tenant-context.js";

const rateLimiter = new InMemoryRateLimiter(30, 60_000);

export const securityMiddleware = (
  request: Request,
  response: Response,
  next: NextFunction,
): void => {
  try {
    const tenantId = request.header("x-tenant-id")?.trim();
    const userId = request.header("x-user-id")?.trim();
    const role = request.header("x-user-role")?.trim() ?? "user";

    if (!tenantId || !userId) {
      response.status(401).json({
        error: {
          code: "AUTHENTICATION_ERROR",
          message: "Tenant and user identity are required.",
        },
      });
      return;
    }

    const context = createTenantContext(tenantId, userId);

    if (
      !authorize({
        context,
        role,
        permission: "chat:write",
      })
    ) {
      response.status(403).json({
        error: {
          code: "AUTHORIZATION_ERROR",
          message: "You are not authorized to use chat.",
        },
      });
      return;
    }

    const rateLimit = rateLimiter.check(context.tenantId);

    if (!rateLimit.allowed) {
      response.status(429).json({
        error: {
          code: "RATE_LIMITED",
          message: "Too many requests.",
        },
        retryAt: rateLimit.resetAt,
      });
      return;
    }

    request.tenantContext = context;
    next();
  } catch (error) {
    next(error);
  }
};
