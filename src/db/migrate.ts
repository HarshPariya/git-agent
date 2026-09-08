import fs from "node:fs/promises";
import path from "node:path";
import { queryWithRetry, withTransaction, closeDatabase } from "./postgres.js";

export interface MigrationRecord {
  version: number;
  name: string;
  applied_at: Date;
}

const MIGRATION_PATTERN = /^(\d+)_/;
const SQL_EXTENSION = ".sql";

const getAppliedVersions = async (): Promise<Set<number>> => {
  const { rows } = await queryWithRetry<MigrationRecord>(
    `SELECT version FROM schema_migrations ORDER BY version ASC`,
  );
  return new Set(rows.map(({ version }) => version));
};

const readMigrationFiles = async (dir: string): Promise<string[]> => {
  try {
    const files = await fs.readdir(dir);
    return files.filter((f) => f.endsWith(SQL_EXTENSION)).sort();
  } catch {
    console.warn(`Migrations directory not found at: ${dir}`);
    return [];
  }
};

const applyMigration = async (filePath: string, fileName: string, version: number) => {
  console.log(`Applying migration ${fileName}...`);
  const sql = await fs.readFile(filePath, "utf8");
  await withTransaction(async (client) => {
    await client.query(sql);
    await client.query(
      `INSERT INTO schema_migrations (version, name) VALUES ($1, $2)`,
      [version, fileName],
    );
  });
  console.log(`Migration ${fileName} applied successfully.`);
};

export const runMigrations = async (
  migrationsDir = path.resolve(process.cwd(), "migrations"),
): Promise<void> => {
  console.log("Checking PostgreSQL database migrations...");

  await queryWithRetry(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  const appliedVersions = await getAppliedVersions();
  const files = await readMigrationFiles(migrationsDir);

  let appliedCount = 0;

  for (const file of files) {
    const match = file.match(MIGRATION_PATTERN);
    if (!match?.[1]) continue;

    const version = Number.parseInt(match[1], 10);
    if (appliedVersions.has(version)) continue;

    await applyMigration(path.join(migrationsDir, file), file, version);
    appliedCount++;
  }

  console.log(
    appliedCount === 0
      ? "Database schema is up to date (no pending migrations)."
      : `Applied ${appliedCount} new migration(s).`,
  );
};

const isMainModule = process.argv[1]?.endsWith("migrate.ts") || process.argv[1]?.endsWith("migrate.js");

if (isMainModule) {
  runMigrations()
    .then(closeDatabase)
    .catch((err) => {
      console.error("Migration failed:", err);
      process.exit(1);
    });
}
