import fs from "node:fs/promises";
import path from "node:path";
import { query, withTransaction } from "./postgres.js";

export interface DatabaseBackupPayload {
  version: number;
  timestamp: string;
  schema_migrations: Array<Record<string, unknown>>;
  repository_status: Array<Record<string, unknown>>;
  code_chunks: Array<Record<string, unknown>>;
}

const DEFAULT_BACKUP_PATH = path.join(process.cwd(), "scratch", "pg_backup.json");

const stringifyValue = (value: unknown): string =>
  typeof value === "string" ? value : JSON.stringify(value);

const formatEmbedding = (embedding: unknown): string =>
  typeof embedding === "string" ? embedding : `[${(embedding as number[]).join(",")}]`;

export const createDatabaseBackup = async (
  backupPath: string = DEFAULT_BACKUP_PATH,
): Promise<DatabaseBackupPayload> => {
  console.log("Creating PostgreSQL database backup...");

  const [migrations, status, chunks] = await Promise.all([
    query(`SELECT * FROM schema_migrations`),
    query(`SELECT * FROM repository_status`),
    query(`SELECT * FROM code_chunks`),
  ]);

  const payload: DatabaseBackupPayload = {
    version: 1,
    timestamp: new Date().toISOString(),
    schema_migrations: migrations.rows,
    repository_status: status.rows,
    code_chunks: chunks.rows,
  };

  await fs.mkdir(path.dirname(backupPath), { recursive: true });
  await fs.writeFile(backupPath, JSON.stringify(payload, null, 2), "utf-8");

  console.log(`Database backup written to ${backupPath} (${chunks.rows.length} chunks saved).`);
  return payload;
};

const RESTORE_REPO_STATUS_SQL = `
  INSERT INTO repository_status (repository, repository_hash, total_files, total_chunks, status, last_indexed_at)
  VALUES ($1, $2, $3, $4, $5, $6)
  ON CONFLICT (repository) DO UPDATE SET
    repository_hash = EXCLUDED.repository_hash, total_files = EXCLUDED.total_files,
    total_chunks = EXCLUDED.total_chunks, status = EXCLUDED.status,
    last_indexed_at = EXCLUDED.last_indexed_at`;

const RESTORE_CODE_CHUNK_SQL = `
  INSERT INTO code_chunks (id, repository, file_path, chunk_type, name, language, start_line, end_line, content, metadata, embedding, content_hash, updated_at)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::vector, $12, NOW())
  ON CONFLICT (id) DO NOTHING`;

export const restoreDatabaseBackup = async (
  backupPath: string = DEFAULT_BACKUP_PATH,
): Promise<number> => {
  console.log(`Restoring PostgreSQL database from ${backupPath}...`);

  const payload: DatabaseBackupPayload = JSON.parse(
    await fs.readFile(backupPath, "utf-8"),
  ) as DatabaseBackupPayload;

  let restoredChunks = 0;

  await withTransaction(async (client) => {
    for (const row of payload.repository_status) {
      await client.query(RESTORE_REPO_STATUS_SQL, [
        row.repository, row.repository_hash, row.total_files,
        row.total_chunks, row.status, row.last_indexed_at,
      ]);
    }

    for (const row of payload.code_chunks) {
      await client.query(RESTORE_CODE_CHUNK_SQL, [
        row.id, row.repository, row.file_path, row.chunk_type, row.name,
        row.language, row.start_line, row.end_line, row.content,
        stringifyValue(row.metadata), formatEmbedding(row.embedding), row.content_hash,
      ]);
      restoredChunks++;
    }
  });

  console.log(`Database restore completed (${restoredChunks} code chunks verified).`);
  return restoredChunks;
};
