import path from "node:path";
import type { NextFunction, Request, Response } from "express";
import { authorize, type Permission } from "../security/authorization.js";
import { InMemoryRateLimiter } from "../security/rate-limit.js";
import { createTenantContext } from "../security/tenant-context.js";
import { verifySessionToken } from "../security/auth.js";
import { getPermissionFromPath } from "./permission.js";

const DEFAULT_RATE_LIMIT_MAX = 30;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;

// Allowlist of workspace path prefixes accepted from the x-workspace-root header.
// Empty allowlist means any absolute path is accepted (dev mode).
const WORKSPACE_ALLOWLIST: readonly string[] = (
  process.env.WORKSPACE_ALLOWLIST?.trim() || ""
).split(",").map((p) => p.trim()).filter(Boolean);

// Sanitize workspace root: must be absolute, no traversal, must match allowlist
const sanitizeWorkspaceRoot = (raw: string | undefined): string => {
  const fallback = process.cwd();
  if (!raw?.trim()) return fallback;
  const candidate = raw.trim();
  if (candidate.includes("\0") || candidate.includes("..") || !path.isAbsolute(candidate))
    return fallback;
  const normalized = path.normalize(candidate);
  if (WORKSPACE_ALLOWLIST.length > 0 &&
    !WORKSPACE_ALLOWLIST.some((prefix) => normalized.startsWith(path.normalize(prefix))))
    return fallback;
  return normalized;
};

export const rateLimiter = new InMemoryRateLimiter(
  Number(process.env.RATE_LIMIT_MAX ?? DEFAULT_RATE_LIMIT_MAX),
  Number(process.env.RATE_LIMIT_WINDOW_MS ?? DEFAULT_RATE_LIMIT_WINDOW_MS),
);

const getHeaderOrQuery = (req: Request, name: string): string | undefined =>
  req.header(name)?.trim() ||
  (typeof req.query?.[name] === "string" ? req.query[name].trim() : undefined);

export const createSecurityMiddleware = (requiredPermission?: Permission) =>
  (request: Request, response: Response, next: NextFunction): void => {
    try {
      let tenantId: string | undefined;
      let userId: string | undefined;
      let role = "user";

      // 1. Check for Bearer token authorization (header or query param for SSE EventSource)
      const authHeader = request.header("authorization")?.trim();
      const queryToken = typeof request.query?.token === "string" ? request.query.token.trim() : undefined;
      const rawToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : queryToken;

      if (rawToken) {
        try {
          const session = verifySessionToken(rawToken);
          tenantId = session.tenantId;
          userId = session.userId;
          role = session.role;
        } catch (authErr) {
          response.status(401).json({ error: { code: "AUTHENTICATION_ERROR", message: authErr instanceof Error ? authErr.message : "Invalid authentication token" } });
          return;
        }
      }

      // In production, a valid Bearer token is mandatory. The dev-mode header
      // fallback (x-tenant-id / x-user-id) below must never be reachable in
      // production -- this guard enforces that invariant.
      if (!rawToken && process.env.NODE_ENV === "production") {
        response.status(401).json({ error: { code: "AUTHENTICATION_ERROR", message: "Bearer authentication is required." } });
        return;
      }

      // Dev-mode fallback: allow identity to be passed via headers instead of a
      // signed token.  ONLY active when NODE_ENV is NOT "production" (the guard
      // above returns 401 before reaching this point in production).
      if (!rawToken) {
        tenantId = getHeaderOrQuery(request, "x-tenant-id") ?? getHeaderOrQuery(request, "tenantId");
        userId = getHeaderOrQuery(request, "x-user-id") ?? getHeaderOrQuery(request, "userId");
        role = getHeaderOrQuery(request, "x-user-role") ?? getHeaderOrQuery(request, "role") ?? "developer";
      }

      if (!tenantId || !userId) {
        response.status(401).json({ error: { code: "AUTHENTICATION_ERROR", message: "Tenant and user identity are required." } });
        return;
      }

      const context = createTenantContext(tenantId, userId);
      const permissionToCheck: Permission = requiredPermission ?? getPermissionFromPath(request.path ?? "", request.method ?? "POST");

      if (!authorize({ context, role, permission: permissionToCheck })) {
        response.status(403).json({ error: { code: "AUTHORIZATION_ERROR", message: "You are not authorized to perform this operation." } });
        return;
      }

      const rateLimit = rateLimiter.check(context.tenantId);
      if (!rateLimit.allowed) {
        response.status(429).json({ error: { code: "RATE_LIMITED", message: "Too many requests." }, retryAt: rateLimit.resetAt });
        return;
      }

      request.tenantContext = context;
      request.workspaceRoot = sanitizeWorkspaceRoot(request.header("x-workspace-root"));
      const wsHeader = request.header("x-workspace-id")?.trim();
      if (wsHeader) request.workspaceId = wsHeader;

      next();
    } catch (error) {
      next(error);
    }
  };

export const securityMiddleware = createSecurityMiddleware();
