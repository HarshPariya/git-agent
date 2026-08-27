import "dotenv/config";
import {
  Pool,
  type PoolClient,
  type QueryResult,
  type QueryResultRow,
} from "pg";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.warn("⚠️ DATABASE_URL is not configured.");
}

export const pool = new Pool({
  connectionString,
  max: Number.parseInt(process.env.PG_POOL_MAX ?? "10", 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  statement_timeout: 10000,
});

pool.on("error", (err) => {
  console.error("❌ Unexpected PostgreSQL Pool Error:", err);
});

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<QueryResult<T>> {
  return pool.query<T>(text, params);
}

export async function queryWithRetry<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
  maxRetries = 3,
  delayMs = 200,
): Promise<QueryResult<T>> {
  let attempt = 0;

  while (true) {
    try {
      return await pool.query<T>(text, params);
    } catch (error: any) {
      attempt++;
      const isTransient =
        error?.code === "ECONNRESET" ||
        error?.code === "ETIMEDOUT" ||
        error?.code === "57P01" ||
        error?.message?.includes("timeout");

      if (isTransient && attempt < maxRetries) {
        console.warn(
          `⚠️ Temporary DB error (${error.message}). Retrying (${attempt}/${maxRetries}) in ${delayMs}ms...`,
        );
        await new Promise((res) => setTimeout(res, delayMs * attempt));
        continue;
      }
      throw error;
    }
  }
}

export async function withTransaction<T>(
  callback: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export interface DatabaseHealthStatus {
  status: "healthy" | "unhealthy";
  latencyMs: number;
  totalConnections: number;
  idleConnections: number;
  waitingCount: number;
  timestamp: string;
}

export async function getDatabaseHealth(): Promise<DatabaseHealthStatus> {
  const startTime = Date.now();

  try {
    await query("SELECT 1");
    const latencyMs = Date.now() - startTime;

    return {
      status: "healthy",
      latencyMs,
      totalConnections: pool.totalCount,
      idleConnections: pool.idleCount,
      waitingCount: pool.waitingCount,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    return {
      status: "unhealthy",
      latencyMs: Date.now() - startTime,
      totalConnections: pool.totalCount,
      idleConnections: pool.idleCount,
      waitingCount: pool.waitingCount,
      timestamp: new Date().toISOString(),
    };
  }
}

export async function testDatabaseConnection(): Promise<boolean> {
  try {
    const health = await getDatabaseHealth();
    if (health.status === "healthy") {
      console.log(`✓ PostgreSQL connected (Latency: ${health.latencyMs}ms, Pool: ${health.totalConnections} active).`);
      return true;
    }
    console.error("❌ PostgreSQL health check failed.");
    return false;
  } catch (error) {
    console.error("❌ PostgreSQL connection failed:", error);
    return false;
  }
}

export async function closeDatabase(): Promise<void> {
  console.log("🔌 Gracefully closing PostgreSQL connection pool...");
  await pool.end();
  console.log("✓ Connection pool closed.");
}
