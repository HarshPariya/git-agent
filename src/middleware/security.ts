import type { NextFunction, Request, Response } from "express";

import { authorize, type Permission } from "../security/authorization.js";
import { InMemoryRateLimiter } from "../security/rate-limit.js";
import { createTenantContext } from "../security/tenant-context.js";

const DEFAULT_RATE_LIMIT_MAX = 30;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;

export const rateLimiter = new InMemoryRateLimiter(
  Number(process.env.RATE_LIMIT_MAX ?? DEFAULT_RATE_LIMIT_MAX),
  Number(process.env.RATE_LIMIT_WINDOW_MS ?? DEFAULT_RATE_LIMIT_WINDOW_MS),
);

export const createSecurityMiddleware = (requiredPermission?: Permission) => {
  return (request: Request, response: Response, next: NextFunction): void => {
    try {
      const tenantId = request.header("x-tenant-id")?.trim();
      const userId = request.header("x-user-id")?.trim();
      const role = request.header("x-user-role")?.trim() ?? "user";

      const missingIdentity = !tenantId || !userId;
      if (missingIdentity) {
        response.status(401).json({
          error: {
            code: "AUTHENTICATION_ERROR",
            message: "Tenant and user identity are required.",
          },
        });
        return;
      }

      const context = createTenantContext(tenantId, userId);

      const reqPath = request.path ?? "";
      const reqMethod = request.method ?? "POST";

      const permissionToCheck: Permission =
        requiredPermission ??
        (reqPath.includes("/documents")
          ? reqMethod === "GET"
            ? "documents:read"
            : "documents:write"
          : "chat:write");

      const unauthorized = !authorize({
        context,
        role,
        permission: permissionToCheck,
      });

      if (unauthorized) {
        response.status(403).json({
          error: {
            code: "AUTHORIZATION_ERROR",
            message: "You are not authorized to perform this operation.",
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
};

export const securityMiddleware = createSecurityMiddleware();

