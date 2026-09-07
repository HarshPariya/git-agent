import fs from "node:fs/promises";
import path from "node:path";
import { queryWithRetry, withTransaction, closeDatabase } from "./postgres.js";

export interface MigrationRecord {
  version: number;
  name: string;
  applied_at: Date;
}

export async function runMigrations(
  migrationsDir = path.resolve(process.cwd(), "migrations"),
): Promise<void> {
  console.log("📦 Checking PostgreSQL database migrations...");

  // 1. Ensure migrations tracking table exists
  await queryWithRetry(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // 2. Fetch applied migrations
  const appliedResult = await queryWithRetry<MigrationRecord>(
    `SELECT version, name, applied_at FROM schema_migrations ORDER BY version ASC`,
  );
  const appliedVersions = new Set(appliedResult.rows.map((row) => row.version));

  // 3. Read migration files
  let files: string[] = [];
  try {
    const entries = await fs.readdir(migrationsDir);
    files = entries.filter((f) => f.endsWith(".sql")).sort();
  } catch (err) {
    console.warn(`⚠️ Migrations directory not found at: ${migrationsDir}`);
    return;
  }

  let appliedCount = 0;

  for (const file of files) {
    const match = file.match(/^(\d+)_/);
    if (!match || !match[1]) {
      continue;
    }

    const version = Number.parseInt(match[1], 10);
    if (appliedVersions.has(version)) {
      continue;
    }

    console.log(`🚀 Applying migration ${file}...`);
    const filePath = path.join(migrationsDir, file);
    const sql = await fs.readFile(filePath, "utf8");

    await withTransaction(async (client) => {
      await client.query(sql);
      await client.query(
        `INSERT INTO schema_migrations (version, name) VALUES ($1, $2)`,
        [version, file],
      );
    });

    console.log(`✓ Migration ${file} applied successfully.`);
    appliedCount++;
  }

  if (appliedCount === 0) {
    console.log("✓ Database schema is up to date (no pending migrations).");
  } else {
    console.log(`✓ Applied ${appliedCount} new migration(s).`);
  }
}

// Standalone runner CLI execution
if (process.argv[1]?.endsWith("migrate.ts") || process.argv[1]?.endsWith("migrate.js")) {
  runMigrations()
    .then(() => closeDatabase())
    .catch((err) => {
      console.error("❌ Migration failed:", err);
      process.exit(1);
    });
}
