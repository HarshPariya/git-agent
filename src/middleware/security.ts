import path from "node:path";
import type { NextFunction, Request, Response } from "express";

import { authorize, type Permission } from "../security/authorization.js";
import { InMemoryRateLimiter } from "../security/rate-limit.js";
import { createTenantContext } from "../security/tenant-context.js";
import { verifySessionToken } from "../security/auth.js";

const DEFAULT_RATE_LIMIT_MAX = 30;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * Allowlist of workspace path prefixes accepted from the x-workspace-root header.
 * An empty allowlist means any absolute path is accepted (dev mode).
 * In production set WORKSPACE_ALLOWLIST as comma-separated absolute path prefixes.
 */
const WORKSPACE_ALLOWLIST: readonly string[] = (
  process.env.WORKSPACE_ALLOWLIST?.trim() || ""
)
  .split(",")
  .map((p) => p.trim())
  .filter(Boolean);

/**
 * Sanitize a workspace root path received from the request header.
 * - Must be absolute
 * - Must not contain path traversal sequences
 * - If WORKSPACE_ALLOWLIST is configured, must start with one of the allowed prefixes
 * Falls back to process.cwd() on any failure.
 */
const sanitizeWorkspaceRoot = (raw: string | undefined): string => {
  const fallback = process.cwd();
  if (!raw?.trim()) return fallback;

  const candidate = raw.trim();

  // Reject paths containing null bytes or traversal sequences
  if (candidate.includes("\0") || candidate.includes("..")) {
    return fallback;
  }

  // Must be an absolute path
  if (!path.isAbsolute(candidate)) {
    return fallback;
  }

  // Normalize separators (tolerate forward slashes on Windows)
  const normalized = path.normalize(candidate);

  // If an allowlist is configured, enforce it
  if (WORKSPACE_ALLOWLIST.length > 0) {
    const allowed = WORKSPACE_ALLOWLIST.some((prefix) =>
      normalized.startsWith(path.normalize(prefix))
    );
    if (!allowed) return fallback;
  }

  return normalized;
};

export const rateLimiter = new InMemoryRateLimiter(
  Number(process.env.RATE_LIMIT_MAX ?? DEFAULT_RATE_LIMIT_MAX),
  Number(process.env.RATE_LIMIT_WINDOW_MS ?? DEFAULT_RATE_LIMIT_WINDOW_MS),
);

export const createSecurityMiddleware = (requiredPermission?: Permission) => {
  return (request: Request, response: Response, next: NextFunction): void => {
    try {
      let tenantId = request.header("x-tenant-id")?.trim();
      let userId = request.header("x-user-id")?.trim();
      let role = request.header("x-user-role")?.trim() ?? "user";

      // 1. Check for Bearer token authorization
      const authHeader = request.header("authorization")?.trim();
      if (authHeader && authHeader.startsWith("Bearer ")) {
        const token = authHeader.slice(7).trim();
        try {
          const session = verifySessionToken(token);
          tenantId = session.tenantId;
          userId = session.userId;
          role = session.role;
        } catch (authErr) {
          response.status(401).json({
            error: {
              code: "AUTHENTICATION_ERROR",
              message: authErr instanceof Error ? authErr.message : "Invalid authentication token",
            },
          });
          return;
        }
      }

      if (!tenantId || !userId) {
        response.status(401).json({
          error: {
            code: "AUTHENTICATION_ERROR",
            message: "Tenant and user identity are required.",
          },
        });
        return;
      }

      const validTenantId: string = tenantId;
      const validUserId: string = userId;
      const context = createTenantContext(validTenantId, validUserId);

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

      // Attach tenant context
      request.tenantContext = context;

      // Attach workspace root (sanitized — never trust raw header value)
      request.workspaceRoot = sanitizeWorkspaceRoot(
        request.header("x-workspace-root")
      );

      // Attach workspace ID
      const wsHeader = request.header("x-workspace-id")?.trim();
      if (wsHeader) {
        request.workspaceId = wsHeader;
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

export const securityMiddleware = createSecurityMiddleware();
