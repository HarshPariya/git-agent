import crypto from "node:crypto";
import { query } from "../db/postgres.js";

export type InsightCategory = "preference" | "fact" | "guideline";

export interface UserInsight {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly category: InsightCategory;
  readonly topic: string;
  readonly insight: string;
  readonly confidence: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export class UserMemoryStore {
  private readonly memoryCache = new Map<string, UserInsight[]>();

  private key(tenantId: string, userId: string): string {
    return `${tenantId}:${userId}`;
  }

  getInsights(
    tenantId: string,
    userId: string,
    category?: InsightCategory,
  ): readonly UserInsight[] {
    const key = this.key(tenantId, userId);
    const insights = this.memoryCache.get(key) ?? [];
    if (!category) {
      return insights;
    }
    return insights.filter((i) => i.category === category);
  }

  async addInsight(
    tenantId: string,
    userId: string,
    data: {
      category: InsightCategory;
      topic: string;
      insight: string;
      confidence?: number;
    },
  ): Promise<UserInsight> {
    const key = this.key(tenantId, userId);
    const existing = this.memoryCache.get(key) ?? [];
    const normalizedTopic = data.topic.trim().toLowerCase();
    const now = new Date().toISOString();

    const existingIdx = existing.findIndex(
      (i) => i.topic.trim().toLowerCase() === normalizedTopic,
    );

    let insightObj: UserInsight;

    if (existingIdx >= 0) {
      const prev = existing[existingIdx];
      if (!prev) throw new Error("Index error");
      insightObj = {
        ...prev,
        category: data.category,
        insight: data.insight,
        confidence: data.confidence ?? prev.confidence,
        updatedAt: now,
      };
      existing[existingIdx] = insightObj;
    } else {
      insightObj = {
        id: `ins-${crypto.randomUUID()}`,
        tenantId,
        userId,
        category: data.category,
        topic: data.topic,
        insight: data.insight,
        confidence: data.confidence ?? 1.0,
        createdAt: now,
        updatedAt: now,
      };
      existing.push(insightObj);
    }

    this.memoryCache.set(key, existing);

    // Persist to Postgres if database is configured
    try {
      if (process.env.DATABASE_URL) {
        await query(
          `
          INSERT INTO user_insights (id, tenant_id, user_id, category, topic, insight, confidence, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          ON CONFLICT (tenant_id, user_id, topic)
          DO UPDATE SET
            category = EXCLUDED.category,
            insight = EXCLUDED.insight,
            confidence = EXCLUDED.confidence,
            updated_at = EXCLUDED.updated_at
        `,
          [
            insightObj.id,
            insightObj.tenantId,
            insightObj.userId,
            insightObj.category,
            insightObj.topic,
            insightObj.insight,
            insightObj.confidence,
            insightObj.createdAt,
            insightObj.updatedAt,
          ],
        );
      }
    } catch {
      // Degrade gracefully if DB is offline or not configured
    }

    return insightObj;
  }

  async loadFromDatabase(tenantId: string, userId: string): Promise<void> {
    if (!process.env.DATABASE_URL) return;
    try {
      const result = await query<any>(
        `SELECT id, tenant_id, user_id, category, topic, insight, confidence, created_at, updated_at
         FROM user_insights WHERE tenant_id = $1 AND user_id = $2
         ORDER BY updated_at DESC`,
        [tenantId, userId],
      );

      const insights: UserInsight[] = result.rows.map((row) => ({
        id: row.id,
        tenantId: row.tenant_id,
        userId: row.user_id,
        category: row.category as InsightCategory,
        topic: row.topic,
        insight: row.insight,
        confidence: Number(row.confidence),
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString(),
      }));

      this.memoryCache.set(this.key(tenantId, userId), insights);
    } catch {
      // Fallback to cache
    }
  }

  formatInsightsForPrompt(tenantId: string, userId: string): string {
    const insights = this.getInsights(tenantId, userId);
    if (insights.length === 0) {
      return "";
    }

    const lines: string[] = ["### Learned User Preferences & Context"];
    for (const item of insights) {
      lines.push(`- **[${item.category.toUpperCase()}] ${item.topic}**: ${item.insight}`);
    }

    return lines.join("\n");
  }

  clear(tenantId: string, userId: string): void {
    this.memoryCache.delete(this.key(tenantId, userId));
  }
}

export const globalUserMemory = new UserMemoryStore();
