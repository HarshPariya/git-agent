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

  await queryWithRetry(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  const appliedResult = await queryWithRetry<MigrationRecord>(
    `SELECT version, name, applied_at FROM schema_migrations ORDER BY version ASC`,
  );
  const appliedVersions = new Set(appliedResult.rows.map((row) => row.version));

  let files: string[] = [];
  try {
    files = (await fs.readdir(migrationsDir))
      .filter((f) => f.endsWith(".sql"))
      .sort();
  } catch {
    console.warn(`⚠️ Migrations directory not found at: ${migrationsDir}`);
    return;
  }

  let appliedCount = 0;

  for (const file of files) {
    const match = file.match(/^(\d+)_/);
    if (!match?.[1]) continue;

    const version = Number.parseInt(match[1], 10);
    if (appliedVersions.has(version)) continue;

    console.log(`🚀 Applying migration ${file}...`);
    const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");

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

  console.log(
    appliedCount === 0
      ? "✓ Database schema is up to date (no pending migrations)."
      : `✓ Applied ${appliedCount} new migration(s).`,
  );
}

if (process.argv[1]?.endsWith("migrate.ts") || process.argv[1]?.endsWith("migrate.js")) {
  runMigrations()
    .then(() => closeDatabase())
    .catch((err) => {
      console.error("❌ Migration failed:", err);
      process.exit(1);
    });
}
