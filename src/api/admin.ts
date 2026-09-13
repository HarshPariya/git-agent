/**
 * Admin API Routes — Restricted to admin role.
 * Provides cross-user data visibility: all users, all activity, all sessions.
 */

import type { NextFunction, Request, Response } from "express";
import { AppError } from "../errors/app-error.js";
import { getCollection, isDatabaseConnected } from "../db/mongodb.js";
import { verifySessionToken } from "../security/auth.js";
import { getAllActivity, getUserActivity, getActivityStats } from "../logging/activity-logger.js";

/** Verify the request is from an admin user. */
function requireAdmin(request: Request): void {
  const ctx = request.tenantContext;
  if (!ctx) throw new AppError("Authentication required", "AUTHENTICATION_ERROR", 401);

  const authHeader = request.header("authorization")?.trim();
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : undefined;
  if (token) {
    try {
      const session = verifySessionToken(token);
      if (session.role === "admin") return;
    } catch {
      // Token invalid — fall through to error
    }
  }
  throw new AppError("Admin access required", "AUTHORIZATION_ERROR", 403);
}

/** Ensure the database is reachable before running admin queries. */
function requireDatabase(): void {
  if (!isDatabaseConnected()) {
    throw new AppError(
      "Database is not available. Please check MongoDB connection and try again.",
      "SERVICE_UNAVAILABLE",
      503,
    );
  }
}

/**
 * GET /api/admin/users — List all registered users.
 * Returns user profiles from MongoDB with avatar data.
 */
export async function listUsersHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    requireAdmin(request);
    requireDatabase();

    const usersCol = getCollection("users");
    const identitiesCol = getCollection("identities");

    const dbUsers = await usersCol.find(
      {},
      { projection: { id: 1, email: 1, name: 1, tenant_id: 1, role: 1, created_at: 1 } },
    ).toArray();

    const identities = await identitiesCol.find(
      {},
      { projection: { user_id: 1, provider: 1, avatar_url: 1 } },
    ).toArray();
    const avatarMap = new Map<string, string>();
    for (const ident of identities) {
      if (ident.provider === "google" && ident.avatar_url) {
        avatarMap.set(ident.user_id as string, ident.avatar_url as string);
      }
    }

    const users = dbUsers.map((u) => ({
      id: u.id as string,
      email: u.email as string,
      name: u.name as string,
      tenantId: u.tenant_id as string,
      role: u.role as string,
      createdAt: (u.created_at as string) ?? "",
      picture: avatarMap.get(u.id as string) ?? undefined,
    }));

    response.status(200).json({ users, total: users.length });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/admin/activity — Get all activity across all users.
 * Query params: limit, skip, action, userId
 */
export async function allActivityHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    requireAdmin(request);
    requireDatabase();

    const limit = Math.min(Number(request.query.limit) || 50, 200);
    const skip = Number(request.query.skip) || 0;
    const action = typeof request.query.action === "string" ? request.query.action : undefined;
    const userId = typeof request.query.userId === "string" ? request.query.userId : undefined;

    const opts: { limit: number; skip: number; action?: string; userId?: string } = { limit, skip };
    if (action) opts.action = action;
    if (userId) opts.userId = userId;
    const result = await getAllActivity(opts);
    response.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/admin/activity/:userId — Get activity for a specific user.
 */
export async function userActivityHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    requireAdmin(request);
    requireDatabase();

    const userId = String(request.params.userId || "");
    if (!userId) throw new AppError("userId is required", "VALIDATION_ERROR", 400);

    const limit = Math.min(Number(request.query.limit) || 50, 200);
    const skip = Number(request.query.skip) || 0;
    const action = typeof request.query.action === "string" ? request.query.action : undefined;

    const opts: { limit: number; skip: number; action?: string } = { limit, skip };
    if (action) opts.action = action;
    const result = await getUserActivity(userId, opts);
    response.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/admin/stats — Get activity statistics (action counts).
 * Query params: userId (optional — all users if omitted)
 */
export async function activityStatsHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    requireAdmin(request);
    requireDatabase();

    const userId = typeof request.query.userId === "string" ? request.query.userId : undefined;
    const stats = await getActivityStats(userId);
    response.status(200).json({ stats });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/admin/aggregate-stats — Get aggregate counts for repos and sessions across all users.
 */
export async function aggregateStatsHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    requireAdmin(request);
    requireDatabase();

    const reposCol = getCollection("repositories");
    const debugCol = getCollection("debug_sessions");

    const [connectedRepos, totalSessions] = await Promise.all([
      reposCol.countDocuments({ status: { $ne: "disconnected" } }),
      debugCol.countDocuments(),
    ]);

    response.status(200).json({ connectedRepos, totalSessions });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/admin/user-data/:userId — Get all data for a specific user.
 * Returns profile, activity summary, repositories, debug sessions.
 */
export async function userDataHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    requireAdmin(request);
    requireDatabase();

    const userId = String(request.params.userId || "");
    if (!userId) throw new AppError("userId is required", "VALIDATION_ERROR", 400);

    const usersCol = getCollection("users");
    const identitiesCol = getCollection("identities");
    const reposCol = getCollection("repositories");
    const debugCol = getCollection("debug_sessions");

    const [userDoc, identity, repos, debugSessions, activityStats] = await Promise.all([
      usersCol.findOne({ id: userId }),
      identitiesCol.findOne({ user_id: userId, provider: "google" }),
      reposCol.find({ userId }).toArray(),
      debugCol.find({ userId }).sort({ createdAt: -1 }).limit(20).toArray(),
      getActivityStats(userId),
    ]);

    if (!userDoc) {
      throw new AppError("User not found", "NOT_FOUND", 404);
    }

    response.status(200).json({
      profile: {
        id: userDoc.id as string,
        email: userDoc.email as string,
        name: userDoc.name as string,
        tenantId: userDoc.tenant_id as string,
        role: userDoc.role as string,
        createdAt: (userDoc.created_at as string) ?? "",
        picture: (identity?.avatar_url as string) ?? undefined,
      },
      repositories: repos.map((r) => ({
        id: r.id as string,
        name: r.name as string,
        path: r.path as string,
        connected: r.connected as boolean,
      })),
      debugSessions: debugSessions.map((s) => ({
        id: s.id as string,
        title: s.title as string,
        status: s.status as string,
        createdAt: s.createdAt as string,
      })),
      activityStats,
    });
  } catch (error) {
    next(error);
  }
}
