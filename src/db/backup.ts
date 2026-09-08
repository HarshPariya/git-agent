import fs from "node:fs/promises";
import path from "node:path";
import { query, withTransaction } from "./postgres.js";

export interface DatabaseBackupPayload {
  version: number;
  timestamp: string;
  schema_migrations: any[];
  repository_status: any[];
  code_chunks: any[];
}

const DEFAULT_BACKUP_PATH = path.join(process.cwd(), "scratch", "pg_backup.json");

export async function createDatabaseBackup(
  backupPath: string = DEFAULT_BACKUP_PATH,
): Promise<DatabaseBackupPayload> {
  console.log("💾 Creating PostgreSQL database backup...");

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

  console.log(`✓ Database backup written to ${backupPath} (${chunks.rows.length} chunks saved).`);
  return payload;
}

export async function restoreDatabaseBackup(
  backupPath: string = DEFAULT_BACKUP_PATH,
): Promise<number> {
  console.log(`🔄 Restoring PostgreSQL database from ${backupPath}...`);

  const payload: DatabaseBackupPayload = JSON.parse(
    await fs.readFile(backupPath, "utf-8")
  );

  let restoredChunks = 0;

  await withTransaction(async (client) => {
    for (const row of payload.repository_status) {
      await client.query(
        `INSERT INTO repository_status (repository, repository_hash, total_files, total_chunks, status, last_indexed_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (repository) DO UPDATE SET
           repository_hash = EXCLUDED.repository_hash, total_files = EXCLUDED.total_files,
           total_chunks = EXCLUDED.total_chunks, status = EXCLUDED.status,
           last_indexed_at = EXCLUDED.last_indexed_at`,
        [row.repository, row.repository_hash, row.total_files, row.total_chunks, row.status, row.last_indexed_at],
      );
    }

    for (const row of payload.code_chunks) {
      const vectorString = typeof row.embedding === "string" ? row.embedding : `[${row.embedding.join(",")}]`;
      await client.query(
        `INSERT INTO code_chunks (id, repository, file_path, chunk_type, name, language, start_line, end_line, content, metadata, embedding, content_hash, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::vector, $12, NOW())
         ON CONFLICT (id) DO NOTHING`,
        [
          row.id, row.repository, row.file_path, row.chunk_type, row.name,
          row.language, row.start_line, row.end_line, row.content,
          typeof row.metadata === "string" ? row.metadata : JSON.stringify(row.metadata),
          vectorString, row.content_hash,
        ],
      );
      restoredChunks++;
    }
  });

  console.log(`✓ Database restore completed (${restoredChunks} code chunks verified).`);
  return restoredChunks;
}
