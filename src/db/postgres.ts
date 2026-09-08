import "dotenv/config";
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) console.warn("DATABASE_URL is not configured.");

const POOL_MAX = Number.parseInt(process.env.PG_POOL_MAX ?? "10", 10);
const DB_TIMEOUT_MS = 5000;
const STATEMENT_TIMEOUT_MS = 10000;
const IDLE_TIMEOUT_MS = 30_000;

const TRANSIENT_CODES = new Set(["ECONNRESET", "ETIMEDOUT", "57P01"]);
const isTransientError = (err: unknown): boolean =>
  err instanceof Error &&
  (TRANSIENT_CODES.has((err as { code?: string }).code ?? "") ||
    err.message.includes("timeout"));

export const pool = new Pool({
  connectionString,
  max: POOL_MAX,
  idleTimeoutMillis: IDLE_TIMEOUT_MS,
  connectionTimeoutMillis: DB_TIMEOUT_MS,
  statement_timeout: STATEMENT_TIMEOUT_MS,
});

pool.on("error", (err) => console.error("Unexpected PostgreSQL Pool Error:", err));

export const query = <T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<QueryResult<T>> => pool.query<T>(text, params);

export const queryWithRetry = async <T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
  maxRetries = 3,
  delayMs = 200,
): Promise<QueryResult<T>> => {
  let attempt = 0;

  while (true) {
    try {
      return await pool.query<T>(text, params);
    } catch (error: unknown) {
      attempt++;
      if (!isTransientError(error) || attempt >= maxRetries) throw error;
      console.warn(
        `Temporary DB error (${error instanceof Error ? error.message : "unknown"}). Retrying (${attempt}/${maxRetries}) in ${delayMs}ms...`,
      );
      await new Promise((res) => setTimeout(res, delayMs * attempt));
    }
  }
};

export const withTransaction = async <T>(
  callback: (client: PoolClient) => Promise<T>,
): Promise<T> => {
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
};

export interface DatabaseHealthStatus {
  status: "healthy" | "unhealthy";
  latencyMs: number;
  totalConnections: number;
  idleConnections: number;
  waitingCount: number;
  timestamp: string;
}

const buildHealth = (status: "healthy" | "unhealthy", latencyMs: number): DatabaseHealthStatus => ({
  status,
  latencyMs,
  totalConnections: pool.totalCount,
  idleConnections: pool.idleCount,
  waitingCount: pool.waitingCount,
  timestamp: new Date().toISOString(),
});

export const getDatabaseHealth = async (): Promise<DatabaseHealthStatus> => {
  const start = Date.now();
  try {
    await query("SELECT 1");
    return buildHealth("healthy", Date.now() - start);
  } catch {
    return buildHealth("unhealthy", Date.now() - start);
  }
};

export const testDatabaseConnection = async (): Promise<boolean> => {
  try {
    const { status, latencyMs, totalConnections } = await getDatabaseHealth();
    if (status === "healthy") {
      console.log(`PostgreSQL connected (Latency: ${latencyMs}ms, Pool: ${totalConnections} active).`);
      return true;
    }
    console.error("PostgreSQL health check failed.");
    return false;
  } catch (error) {
    console.error("PostgreSQL connection failed:", error);
    return false;
  }
};

export const closeDatabase = async (): Promise<void> => {
  console.log("Closing PostgreSQL connection pool...");
  await pool.end();
  console.log("Connection pool closed.");
};
