/**
 * Activity Logger — Per-user action history stored in MongoDB
 * Every user action (git ops, debug sessions, auth events, etc.) is logged
 * with userId, timestamp, and details. Admin can query all; users see only theirs.
 */

import { getCollection, isDatabaseConnected } from "../db/mongodb.js";

export interface ActivityEntry {
  readonly userId: string;
  readonly email: string;
  readonly name: string;
  readonly tenantId: string;
  readonly role: string;
  readonly action: string;
  readonly details: Record<string, unknown>;
  readonly timestamp: Date;
  readonly ipAddress: string;
  readonly userAgent: string;
}

export interface ActivityRequest {
  readonly userId: string;
  readonly email: string;
  readonly name: string;
  readonly tenantId: string;
  readonly role: string;
  readonly ipAddress?: string;
  readonly userAgent?: string;
}

/**
 * Log a user activity event to the `activity_history` MongoDB collection.
 * Fire-and-forget: errors are caught and logged, never thrown to the caller.
 */
export async function logActivity(
  user: ActivityRequest,
  action: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  if (!isDatabaseConnected()) return;
  try {
    const col = getCollection("activity_history");
    const entry: ActivityEntry = {
      userId: user.userId,
      email: user.email,
      name: user.name,
      tenantId: user.tenantId,
      role: user.role,
      action,
      details,
      timestamp: new Date(),
      ipAddress: user.ipAddress ?? "unknown",
      userAgent: user.userAgent ?? "unknown",
    };
    await col.insertOne(entry);
  } catch (err) {
    // Never block the main request — just log the failure
    console.warn(
      `[ACTIVITY] Failed to log activity "${action}" for user ${user.userId}:`,
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Create indexes for the activity_history collection.
 * Called once on server startup. Idempotent.
 */
export async function ensureActivityIndexes(): Promise<void> {
  if (!isDatabaseConnected()) return;
  try {
    const col = getCollection("activity_history");
    await col.createIndex({ userId: 1, timestamp: -1 });
    await col.createIndex({ action: 1, timestamp: -1 });
    await col.createIndex({ timestamp: -1 });
  } catch (err) {
    console.warn("[ACTIVITY] Failed to create indexes:", err instanceof Error ? err.message : err);
  }
}

/**
 * Query activity history for a single user.
 * Admin can use this to view any user's activity; regular users see only their own.
 */
export async function getUserActivity(
  userId: string,
  options: { limit?: number; skip?: number; action?: string } = {},
): Promise<{ entries: ActivityEntry[]; total: number }> {
  if (!isDatabaseConnected()) return { entries: [], total: 0 };
  const col = getCollection("activity_history");
  const filter: Record<string, unknown> = { userId };
  if (options.action) filter.action = options.action;

  const limit = Math.min(options.limit ?? 50, 200);
  const skip = options.skip ?? 0;

  const [entries, total] = await Promise.all([
    col.find(filter).sort({ timestamp: -1 }).skip(skip).limit(limit).toArray(),
    col.countDocuments(filter),
  ]);

  return { entries: entries as unknown as ActivityEntry[], total };
}

/**
 * Query ALL activity history (admin only).
 */
export async function getAllActivity(
  options: { limit?: number; skip?: number; action?: string; userId?: string } = {},
): Promise<{ entries: ActivityEntry[]; total: number }> {
  if (!isDatabaseConnected()) return { entries: [], total: 0 };
  const col = getCollection("activity_history");
  const filter: Record<string, unknown> = {};
  if (options.action) filter.action = options.action;
  if (options.userId) filter.userId = options.userId;

  const limit = Math.min(options.limit ?? 50, 200);
  const skip = options.skip ?? 0;

  const [entries, total] = await Promise.all([
    col.find(filter).sort({ timestamp: -1 }).skip(skip).limit(limit).toArray(),
    col.countDocuments(filter),
  ]);

  return { entries: entries as unknown as ActivityEntry[], total };
}

/**
 * Get activity stats: total count per action type for a user (or all users).
 */
export async function getActivityStats(userId?: string): Promise<Record<string, number>> {
  if (!isDatabaseConnected()) return {};
  const col = getCollection("activity_history");
  const match: Record<string, unknown> = userId ? { userId } : {};

  const pipeline = [
    ...(Object.keys(match).length ? [{ $match: match }] : []),
    { $group: { _id: "$action", count: { $sum: 1 } } },
    { $sort: { count: -1 as const } },
  ];

  const results = await col.aggregate(pipeline).toArray();
  const stats: Record<string, number> = {};
  for (const row of results) {
    stats[(row as { _id: string })._id] = (row as { count: number }).count;
  }
  return stats;
}
