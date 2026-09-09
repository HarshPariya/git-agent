import path from "node:path";
import type { NextFunction, Request, Response } from "express";
import { authorize, type Permission } from "../security/authorization.js";
import { InMemoryRateLimiter } from "../security/rate-limit.js";
import { createTenantContext } from "../security/tenant-context.js";
import { verifySessionToken } from "../security/auth.js";
import { getPermissionFromPath } from "./permission.js";

const DEFAULT_RATE_LIMIT_MAX = 100;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;

const WORKSPACE_ALLOWLIST: readonly string[] = (
  process.env.WORKSPACE_ALLOWLIST?.trim() || ""
).split(",").map((p) => p.trim()).filter(Boolean);

const isPathTraversal = (candidate: string): boolean =>
  candidate.includes("\0") || candidate.includes("..") || !path.isAbsolute(candidate);

const isAllowlisted = (normalized: string): boolean =>
  WORKSPACE_ALLOWLIST.length === 0 ||
  WORKSPACE_ALLOWLIST.some((prefix) => normalized.startsWith(path.normalize(prefix)));

const sanitizeWorkspaceRoot = (raw: string | undefined): string => {
  if (!raw?.trim()) return process.cwd();
  const candidate = raw.trim();
  if (isPathTraversal(candidate)) return process.cwd();
  const normalized = path.normalize(candidate);
  return isAllowlisted(normalized) ? normalized : process.cwd();
};

export const rateLimiter = new InMemoryRateLimiter(
  Number(process.env.RATE_LIMIT_MAX ?? DEFAULT_RATE_LIMIT_MAX),
  Number(process.env.RATE_LIMIT_WINDOW_MS ?? DEFAULT_RATE_LIMIT_WINDOW_MS),
);

const getHeaderOrQuery = (req: Request, name: string): string | undefined =>
  req.header(name)?.trim() ||
  (typeof req.query?.[name] === "string" ? req.query[name].trim() : undefined);

const extractBearerToken = (req: Request): string | undefined => {
  const authHeader = req.header("authorization")?.trim();
  if (authHeader?.startsWith("Bearer ")) return authHeader.slice(7).trim();
  return typeof req.query?.token === "string" ? req.query.token.trim() : undefined;
};

const extractDevIdentity = (req: Request) => ({
  tenantId: getHeaderOrQuery(req, "x-tenant-id") ?? getHeaderOrQuery(req, "tenantId"),
  userId: getHeaderOrQuery(req, "x-user-id") ?? getHeaderOrQuery(req, "userId"),
  role: getHeaderOrQuery(req, "x-user-role") ?? getHeaderOrQuery(req, "role") ?? "developer",
});

const sendError = (res: Response, status: number, code: string, message: string): void => {
  res.status(status).json({ error: { code, message } });
};

export const createSecurityMiddleware = (requiredPermission?: Permission) =>
  (request: Request, response: Response, next: NextFunction): void => {
    try {
      const rawToken = extractBearerToken(request);
      let tenantId: string | undefined;
      let userId: string | undefined;
      let role = "user";

      if (rawToken) {
        try {
          const session = verifySessionToken(rawToken);
          tenantId = session.tenantId;
          userId = session.userId;
          role = session.role;
        } catch (authErr) {
          sendError(response, 401, "AUTHENTICATION_ERROR", authErr instanceof Error ? authErr.message : "Invalid authentication token");
          return;
        }
      }

      if (!rawToken && process.env.NODE_ENV === "production") {
        sendError(response, 401, "AUTHENTICATION_ERROR", "Bearer authentication is required.");
        return;
      }

      if (!rawToken) {
        const devIdentity = extractDevIdentity(request);
        tenantId = devIdentity.tenantId;
        userId = devIdentity.userId;
        role = devIdentity.role;
      }

      if (!tenantId || !userId) {
        sendError(response, 401, "AUTHENTICATION_ERROR", "Tenant and user identity are required.");
        return;
      }

      const context = createTenantContext(tenantId, userId);
      const permissionToCheck: Permission = requiredPermission ?? getPermissionFromPath(request.path ?? "", request.method ?? "POST");

      if (!authorize({ context, role, permission: permissionToCheck })) {
        sendError(response, 403, "AUTHORIZATION_ERROR", "You are not authorized to perform this operation.");
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
