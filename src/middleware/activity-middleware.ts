/**
 * Activity Logging Middleware — Automatically logs user actions to MongoDB.
 * Intercepts POST/DELETE/PATCH requests and records them with user context.
 */

import type { NextFunction, Request, Response } from "express";
import { verifySessionToken } from "../security/auth.js";
import { logActivity, type ActivityRequest } from "../logging/activity-logger.js";

/** Actions we want to track (path prefix → action name). */
const TRACKED_ACTIONS: ReadonlyArray<{ pattern: RegExp; action: string }> = [
  // Auth events
  { pattern: /^\/api\/auth\/login/, action: "auth:login" },
  { pattern: /^\/api\/auth\/register/, action: "auth:register" },
  { pattern: /^\/api\/auth\/google/, action: "auth:google-login" },

  // Git operations
  { pattern: /^\/api\/git\/commit/, action: "git:commit" },
  { pattern: /^\/api\/git\/push/, action: "git:push" },
  { pattern: /^\/api\/git\/pull/, action: "git:pull" },
  { pattern: /^\/api\/git\/fetch/, action: "git:fetch" },
  { pattern: /^\/api\/git\/checkout/, action: "git:checkout" },
  { pattern: /^\/api\/git\/sync/, action: "git:sync" },
  { pattern: /^\/api\/git\/ship/, action: "git:ship" },
  { pattern: /^\/api\/git\/analyze-changes/, action: "git:analyze-changes" },
  { pattern: /^\/api\/git\/commit-plan/, action: "git:commit-plan-execute" },
  { pattern: /^\/api\/git\/commit-all/, action: "git:commit-all" },
  { pattern: /^\/api\/git\/generate-commit-message/, action: "git:generate-message" },
  { pattern: /^\/api\/git\/conflicts\/resolve/, action: "git:resolve-conflicts" },

  // Debug operations
  { pattern: /^\/api\/debug\/run/, action: "debug:run" },
  { pattern: /^\/api\/debug\/classify/, action: "debug:classify" },
  { pattern: /^\/api\/debug\/plan/, action: "debug:plan" },
  { pattern: /^\/api\/debug$/, action: "debug:start" },
  { pattern: /^\/api\/debug\/[^/]+\/complete/, action: "debug:complete" },
  { pattern: /^\/api\/debug\/[^/]+\/abort/, action: "debug:abort" },
  { pattern: /^\/api\/debug\/[^/]+\/fix\/approve/, action: "debug:approve-fix" },
  { pattern: /^\/api\/debug\/[^/]+\/fix\/revert/, action: "debug:revert-fix" },
  { pattern: /^\/api\/debug\/[^/]+\/steps/, action: "debug:execute-step" },

  // Repository operations
  { pattern: /^\/api\/repositories\/connect/, action: "repo:connect" },
  { pattern: /^\/api\/repositories\/[^/]+\/disconnect/, action: "repo:disconnect" },
  { pattern: /^\/api\/repositories\/[^/]+\/sync/, action: "repo:sync" },

  // GraphRAG
  { pattern: /^\/api\/graphrag\/index/, action: "graphrag:index" },
  { pattern: /^\/api\/graphrag\/search/, action: "graphrag:search" },

  // GitHub
  { pattern: /^\/api\/github\/connect/, action: "github:connect" },

  // Settings / agent config
  { pattern: /^\/api\/ci$/, action: "ci:trigger" },
  { pattern: /^\/api\/pr$/, action: "pr:create" },
];

function matchAction(path: string, method: string): string | undefined {
  if (method === "GET") return undefined; // Don't log reads
  for (const { pattern, action } of TRACKED_ACTIONS) {
    if (pattern.test(path)) return action;
  }
  return undefined;
}

/** Extract user identity from the bearer token for activity logging. */
function extractUserFromToken(request: Request): ActivityRequest | undefined {
  const authHeader = request.header("authorization")?.trim();
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : undefined;
  const ctx = request.tenantContext;

  if (!ctx) return undefined;

  let email = `${ctx.userId}@local.dev`;
  let role = "developer";

  // Try to extract richer identity from the session token
  if (token) {
    try {
      const session = verifySessionToken(token);
      if (session.email) email = session.email;
      if (session.role) role = session.role;
    } catch {
      // Token might be invalid/expired by now — use defaults
    }
  }

  return {
    userId: ctx.userId,
    email,
    name: email.split("@")[0] || ctx.userId,
    tenantId: ctx.tenantId,
    role,
    ipAddress: request.ip ?? request.socket.remoteAddress ?? "unknown",
    userAgent: request.header("user-agent") ?? "unknown",
  };
}

/**
 * Express middleware that logs tracked write operations to activity_history.
 * Must run AFTER securityMiddleware (which sets `request.tenantContext`).
 */
export function activityMiddleware(request: Request, _response: Response, next: NextFunction): void {
  const action = matchAction(request.path, request.method ?? "GET");
  if (!action) {
    next();
    return;
  }

  const user = extractUserFromToken(request);
  if (!user) {
    next();
    return;
  }

  // Extract meaningful details from the request body
  const body = (typeof request.body === "object" && request.body !== null ? request.body : {}) as Record<string, unknown>;
  const details: Record<string, unknown> = {};
  if (body.repositoryId) details.repositoryId = body.repositoryId;
  if (typeof body.query === "string") details.query = body.query.slice(0, 200);
  if (typeof body.message === "string") details.message = body.message.slice(0, 200);
  if (body.sessionId) details.sessionId = body.sessionId;
  if (body.branch) details.branch = body.branch;
  if (body.remote) details.remote = body.remote;

  // Fire-and-forget — don't await, don't block
  logActivity(user, action, details).catch(() => {
    // Already handled inside logActivity
  });

  next();
}
