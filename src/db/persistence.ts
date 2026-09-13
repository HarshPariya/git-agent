import type { Collection, Document } from "mongodb";
import { getCollection, isDatabaseConnected } from "./mongodb.js";
import type { Repository, DebugSession } from "../types/git.js";
import { logger } from "../logging/logger.js";

/**
 * Best-effort persistence helpers for cross-restart durability.
 * Repositories and debug sessions are kept in-memory for live operation,
 * and mirrored to MongoDB so the dashboard / admin stats survive restarts.
 * Every write is fire-and-forget: failures are logged, never thrown.
 */

// --- Repositories ---

export async function persistRepository(repo: Repository): Promise<void> {
  if (!isDatabaseConnected()) return;
  try {
    const col: Collection<Document> = getCollection("repositories");
    await col.updateOne(
      { id: repo.id },
      {
        $set: {
          id: repo.id,
          tenant_id: repo.tenantId,
          user_id: repo.userId,
          name: repo.name,
          url: repo.url ?? null,
          local_path: repo.localPath,
          default_branch: repo.defaultBranch,
          current_branch: repo.currentBranch,
          status: repo.status,
          last_sync_at: repo.lastSyncAt ?? null,
          created_at: repo.createdAt,
          updated_at: new Date().toISOString(),
        },
      },
      { upsert: true },
    );
  } catch (err) {
    logger.warn("Failed to persist repository", {
      operation: "persistence",
      metadata: { id: repo.id, error: err instanceof Error ? err.message : String(err) },
    });
  }
}

export async function markRepositoryDisconnected(repositoryId: string): Promise<void> {
  if (!isDatabaseConnected()) return;
  try {
    const col: Collection<Document> = getCollection("repositories");
    await col.updateOne(
      { id: repositoryId },
      { $set: { status: "disconnected", updated_at: new Date().toISOString() } },
    );
  } catch (err) {
    logger.warn("Failed to mark repository disconnected", {
      operation: "persistence",
      metadata: { id: repositoryId, error: err instanceof Error ? err.message : String(err) },
    });
  }
}

/**
 * Backfill `created_at` for users created before the field existed (e.g. earlier
 * Google OAuth signups). Uses the user's earliest activity history timestamp when
 * available, otherwise now. Fixes the admin panel showing "—" for older users.
 */
export async function backfillUserCreatedAt(): Promise<void> {
  if (!isDatabaseConnected()) return;
  try {
    const usersCol = getCollection("users");
    const activityCol = getCollection("activity_history");
    const missing = await usersCol
      .find({ $or: [{ created_at: { $exists: false } }, { created_at: null }, { created_at: "" }] })
      .toArray();
    if (missing.length === 0) return;

    let fixed = 0;
    for (const user of missing) {
      const userId = user.id as string;
      const earliest = await activityCol.find({ userId }).sort({ timestamp: 1 }).limit(1).next();
      const created_at =
        earliest?.timestamp instanceof Date
          ? earliest.timestamp.toISOString()
          : new Date().toISOString();
      await usersCol.updateOne({ id: userId }, { $set: { created_at } });
      fixed++;
    }
    if (fixed > 0) {
      logger.info("Backfilled created_at for users missing the field", {
        operation: "user-backfill",
        metadata: { count: fixed },
      });
    }
  } catch (err) {
    logger.warn("Failed to backfill user created_at", {
      operation: "user-backfill",
      metadata: { error: err instanceof Error ? err.message : String(err) },
    });
  }
}

export async function loadRepositoriesFromDb(): Promise<Repository[]> {
  if (!isDatabaseConnected()) return [];
  try {
    const col: Collection<Document> = getCollection("repositories");
    const docs = await col.find({ status: { $ne: "disconnected" } }).toArray();
    return docs.map((d): Repository => ({
      id: d.id as string,
      tenantId: d.tenant_id as string,
      userId: (d.user_id as string) ?? "",
      name: d.name as string,
      url: (d.url as string) ?? undefined,
      localPath: d.local_path as string,
      defaultBranch: d.default_branch as string,
      currentBranch: d.current_branch as string,
      status: (d.status as Repository["status"]) ?? "connected",
      lastSyncAt: (d.last_sync_at as string) ?? undefined,
      createdAt: d.created_at as string,
      protectedBranches: [],
    }));
  } catch (err) {
    logger.warn("Failed to load repositories from database", {
      operation: "persistence",
      metadata: { error: err instanceof Error ? err.message : String(err) },
    });
    return [];
  }
}

// --- Debug Sessions ---

export async function persistDebugSession(session: DebugSession): Promise<void> {
  if (!isDatabaseConnected()) return;
  try {
    const col: Collection<Document> = getCollection("debug_sessions");
    await col.updateOne(
      { id: session.id },
      {
        $set: {
          id: session.id,
          repository_id: session.repositoryId,
          tenant_id: session.tenantId,
          user_id: session.userId,
          title: session.title,
          mode: session.mode,
          status: session.status,
          started_at: session.startedAt,
          completed_at: session.completedAt ?? null,
          current_step: session.currentStep,
          total_steps: session.totalSteps,
          steps: session.steps,
          findings: session.findings,
          updated_at: new Date().toISOString(),
        },
      },
      { upsert: true },
    );
  } catch (err) {
    logger.warn("Failed to persist debug session", {
      operation: "persistence",
      metadata: { id: session.id, error: err instanceof Error ? err.message : String(err) },
    });
  }
}

export async function loadDebugSessionsFromDb(tenantId: string, userId?: string): Promise<DebugSession[]> {
  if (!isDatabaseConnected()) return [];
  try {
    const col: Collection<Document> = getCollection("debug_sessions");
    const query: Document = { tenant_id: tenantId };
    if (userId) query.user_id = userId;
    const docs = await col.find(query).sort({ started_at: -1 }).toArray();
    return docs.map((d): DebugSession => ({
      id: d.id as string,
      repositoryId: d.repository_id as string,
      tenantId: d.tenant_id as string,
      userId: d.user_id as string,
      title: d.title as string,
      mode: (d.mode as DebugSession["mode"]) ?? "debug",
      status: (d.status as DebugSession["status"]) ?? "active",
      startedAt: d.started_at as string,
      completedAt: (d.completed_at as string) ?? undefined,
      currentStep: (d.current_step as number) ?? 0,
      totalSteps: (d.total_steps as number) ?? 0,
      steps: (d.steps as DebugSession["steps"]) ?? [],
      findings: (d.findings as DebugSession["findings"]) ?? [],
    }));
  } catch (err) {
    logger.warn("Failed to load debug sessions from database", {
      operation: "persistence",
      metadata: { error: err instanceof Error ? err.message : String(err) },
    });
    return [];
  }
}

/** Map a persisted debug session document back into a DebugSession object. */
function mapDebugSessionDoc(d: Document): DebugSession {
  return {
    id: d.id as string,
    repositoryId: d.repository_id as string,
    tenantId: d.tenant_id as string,
    userId: d.user_id as string,
    title: d.title as string,
    mode: (d.mode as DebugSession["mode"]) ?? "debug",
    status: (d.status as DebugSession["status"]) ?? "active",
    startedAt: d.started_at as string,
    completedAt: (d.completed_at as string) ?? undefined,
    currentStep: (d.current_step as number) ?? 0,
    totalSteps: (d.total_steps as number) ?? 0,
    steps: (d.steps as DebugSession["steps"]) ?? [],
    findings: (d.findings as DebugSession["findings"]) ?? [],
  };
}

/**
 * Load a single debug session by its id from MongoDB.
 * Used to reopen sessions that are no longer held in memory (e.g. after a restart).
 */
export async function loadDebugSessionByIdFromDb(sessionId: string): Promise<DebugSession | undefined> {
  if (!isDatabaseConnected()) return undefined;
  try {
    const col: Collection<Document> = getCollection("debug_sessions");
    const d = await col.findOne({ id: sessionId });
    return d ? mapDebugSessionDoc(d) : undefined;
  } catch (err) {
    logger.warn("Failed to load debug session by id from database", {
      operation: "persistence",
      metadata: { sessionId, error: err instanceof Error ? err.message : String(err) },
    });
    return undefined;
  }
}