import dns from "node:dns";
import os from "node:os";
import {
  MongoClient,
  type Db,
  type Collection,
  type Document,
  type MongoError,
  type Filter,
  type FindOneOptions,
  type AnyBulkWriteOperation,
  type ClientSession,
} from "mongodb";

// Fix Node.js DNS resolution on Windows where dns.getServers() may return
// 127.0.0.1 (loopback) instead of the actual network DNS server, causing
// SRV record lookups for mongodb+srv:// connections to fail with ECONNREFUSED.
const fixNodeDnsResolution = (): void => {
  if (process.platform !== "win32") return;
  const current = dns.getServers();
  const needsFix = current.every((s) => s === "127.0.0.1" || s === "::1" || s === "localhost");
  if (!needsFix) return;

  const fallback = ["8.8.8.8", "8.8.4.4"];
  const interfaces = os.networkInterfaces();
  const systemDns: string[] = [];
  for (const addrs of Object.values(interfaces)) {
    if (!addrs) continue;
    for (const a of addrs) {
      if (a.family === "IPv4" && !a.internal && a.address) systemDns.push(a.address);
    }
  }

  // Use router/DHCP DNS (typically x.x.x.1) as primary, Google DNS as fallback
  const routerDns = systemDns.map((ip) => ip.replace(/\d+$/, "1")).filter((ip) => ip !== "0.0.0.0");
  const servers = [...new Set([...routerDns, ...fallback])];
  dns.setServers(servers);
  console.warn(`MongoDB DNS fix: switched Node.js DNS from ${current.join(",")} to ${servers.join(",")}`);
};

fixNodeDnsResolution();

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || "ai_chatbot";

if (!MONGODB_URI) console.warn("MONGODB_URI is not configured.");

const DB_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 500;

let client: MongoClient | null = null;
let db: Db | null = null;
let connected = false;

/** Whether the database connection is alive and ready for queries. */
export const isDatabaseConnected = (): boolean => connected;

const isTransientError = (err: unknown): boolean => {
  if (!(err instanceof Error)) return false;
  const code = (err as MongoError & { code?: number }).code;
  return (
    code === 6 || // HostUnreachable
    code === 7 || // HostNotFound
    code === 89 || // NetworkTimeout
    code === 91 || // ShutdownInProgress
    code === 189 || // PrimarySteppedDown
    code === 262 || // ExceededTimeLimit
    err.message.includes("connection") ||
    err.message.includes("timeout")
  );
};

const getClient = (): MongoClient => {
  if (!client) {
    if (!MONGODB_URI) throw new Error("MONGODB_URI is not configured.");
    client = new MongoClient(MONGODB_URI, {
      connectTimeoutMS: DB_TIMEOUT_MS,
      socketTimeoutMS: 15_000,
      serverSelectionTimeoutMS: DB_TIMEOUT_MS,
      maxPoolSize: Number.parseInt(process.env.MONGO_POOL_MAX ?? "10", 10),
      minPoolSize: 1,
      retryWrites: true,
      retryReads: true,
    });
  }
  return client;
};

export const getDb = (): Db => {
  if (!db) {
    db = getClient().db(MONGODB_DB_NAME);
  }
  return db;
};

export const getCollection = <T extends Document = Document>(name: string): Collection<T> =>
  getDb().collection<T>(name);

export const connectDatabase = async (): Promise<void> => {
  const c = getClient();
  await c.connect();
  await getDb().command({ ping: 1 });
  connected = true;
  console.warn(`MongoDB connected to ${MONGODB_DB_NAME}.`);
};

let connectPromise: Promise<boolean> | null = null;

/** Ensure the database connection is established, reconnecting lazily if necessary (e.g. in serverless environments). */
export const ensureDatabaseConnected = async (): Promise<boolean> => {
  if (connected && client) return true;
  if (!MONGODB_URI) return false;
  if (connectPromise) return connectPromise;

  connectPromise = (async () => {
    try {
      await connectDatabase();
      return true;
    } catch (err) {
      console.error("Failed to connect to MongoDB:", err instanceof Error ? err.message : err);
      connected = false;
      return false;
    } finally {
      connectPromise = null;
    }
  })();

  return connectPromise;
};

export const query = async <T extends Document = Document>(
  collectionName: string,
  filter: Document = {},
  options?: { sort?: Document; limit?: number; projection?: Document },
): Promise<T[]> => {
  const col = getCollection<T>(collectionName);
  let cursor = col.find(filter as Filter<T>);
  if (options?.sort) cursor = cursor.sort(options.sort);
  if (options?.limit) cursor = cursor.limit(options.limit);
  if (options?.projection) cursor = cursor.project(options.projection);
  return cursor.toArray() as Promise<T[]>;
};

export const queryOne = async <T extends Document = Document>(
  collectionName: string,
  filter: Document = {},
  options?: { projection?: Document },
): Promise<T | null> => {
  return getCollection<T>(collectionName).findOne(filter as Filter<T>, options as FindOneOptions) as Promise<T | null>;
};

export const queryWithRetry = async <T extends Document = Document>(
  collectionName: string,
  filter: Document = {},
  options?: { sort?: Document; limit?: number; projection?: Document },
  maxRetries = MAX_RETRIES,
  delayMs = RETRY_DELAY_MS,
): Promise<T[]> => {
  let attempt = 0;
  while (true) {
    try {
      return await query<T>(collectionName, filter, options);
    } catch (error: unknown) {
      attempt++;
      if (!isTransientError(error) || attempt >= maxRetries) throw error;
      console.warn(
        `Temporary MongoDB error (${error instanceof Error ? error.message : "unknown"}). Retrying (${attempt}/${maxRetries}) in ${delayMs}ms...`,
      );
      await new Promise((res) => setTimeout(res, delayMs * attempt));
    }
  }
};

export const withTransaction = async <T>(callback: (session: ClientSession) => Promise<T>): Promise<T> => {
  const c = getClient();
  const session = c.startSession();
  try {
    let result: T | undefined;
    await session.withTransaction(async () => {
      result = await callback(session);
    });
    return result!;
  } finally {
    await session.endSession();
  }
};

export const insertOne = async (collectionName: string, document: Document): Promise<void> => {
  await getCollection(collectionName).insertOne(document);
};

export const insertMany = async (collectionName: string, documents: Document[]): Promise<void> => {
  if (documents.length === 0) return;
  await getCollection(collectionName).insertMany(documents, { ordered: false });
};

export const updateOne = async (
  collectionName: string,
  filter: Document,
  update: Document,
  upsert = true,
): Promise<void> => {
  await getCollection(collectionName).updateOne(filter, { $set: update }, { upsert });
};

export const deleteOne = async (collectionName: string, filter: Document): Promise<number> => {
  const result = await getCollection(collectionName).deleteOne(filter);
  return result.deletedCount;
};

export const deleteMany = async (collectionName: string, filter: Document): Promise<number> => {
  const result = await getCollection(collectionName).deleteMany(filter);
  return result.deletedCount;
};

export const countDocuments = async (collectionName: string, filter: Document = {}): Promise<number> => {
  return getCollection(collectionName).countDocuments(filter);
};

export const bulkWrite = async (collectionName: string, operations: Document[]): Promise<void> => {
  if (operations.length === 0) return;
  await getCollection(collectionName).bulkWrite(operations as AnyBulkWriteOperation<Document>[], { ordered: false });
};

export const aggregate = async <T extends Document = Document>(
  collectionName: string,
  pipeline: Document[],
): Promise<T[]> => {
  return getCollection<T>(collectionName).aggregate(pipeline).toArray() as Promise<T[]>;
};

export interface DatabaseHealthStatus {
  status: "healthy" | "unhealthy";
  latencyMs: number;
  totalConnections: number;
  idleConnections: number;
  waitingCount: number;
  timestamp: string;
}

export const getDatabaseHealth = async (): Promise<DatabaseHealthStatus> => {
  const start = Date.now();
  try {
    await getDb().command({ ping: 1 });
    const status = (await getDb().admin().serverStatus()) as {
      connections?: { active?: number; available?: number; current?: number };
    };
    return {
      status: "healthy",
      latencyMs: Date.now() - start,
      totalConnections: status.connections?.active ?? 0,
      idleConnections: status.connections?.available ?? 0,
      waitingCount: status.connections?.current ?? 0,
      timestamp: new Date().toISOString(),
    };
  } catch {
    return {
      status: "unhealthy",
      latencyMs: Date.now() - start,
      totalConnections: 0,
      idleConnections: 0,
      waitingCount: 0,
      timestamp: new Date().toISOString(),
    };
  }
};

export const testDatabaseConnection = async (): Promise<boolean> => {
  try {
    const health = await getDatabaseHealth();
    if (health.status === "healthy") {
      console.warn(`MongoDB connected (Latency: ${health.latencyMs}ms).`);
      return true;
    }
    console.error("MongoDB health check failed.");
    return false;
  } catch (error) {
    console.error("MongoDB connection failed:", error);
    return false;
  }
};

export const closeDatabase = async (): Promise<void> => {
  connectPromise = null;
  if (client) {
    console.warn("Closing MongoDB connection...");
    await client.close();
    client = null;
    db = null;
    connected = false;
    console.warn("MongoDB connection closed.");
  }
};

/** Get pool statistics for observability */
export const getPoolStats = () => {
  const s = getClient().options;
  return {
    totalConnections: s.maxPoolSize ?? 10,
    idleConnections: s.minPoolSize ?? 0,
    waitingCount: 0,
  };
};
