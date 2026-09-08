import crypto from "node:crypto";
import type { CodeChunk } from "../ingestion/chunker.js";
import { embedText } from "../ingestion/embedder.js";
import { query } from "./postgres.js";
import type { VectorSearchResult } from "../retrieval/vector-search.js";

export interface StoredChunkRow {
  id: string;
  repository: string;
  file_path: string;
  chunk_type: string;
  name: string | null;
  language: string | null;
  start_line: number;
  end_line: number;
  content: string;
  metadata: Record<string, unknown>;
  content_hash?: string;
  similarity?: number;
}

export interface VectorSearchFilterOptions {
  repository?: string;
  language?: string;
  chunkType?: string;
  filePathPrefix?: string;
  metadata?: Record<string, unknown>;
  limit?: number;
}

export interface UpsertResultStats {
  inserted: number;
  updated: number;
  skipped: number;
  deletedStale: number;
  total: number;
}

const computeContentHash = (content: string): string =>
  crypto.createHash("sha256").update(content).digest("hex");

export async function deleteStaleChunks(
  repository: string,
  activeChunkIds: string[],
): Promise<number> {
  if (activeChunkIds.length === 0) {
    const result = await query(`DELETE FROM code_chunks WHERE repository = $1`, [repository]);
    return result.rowCount ?? 0;
  }

  const result = await query(
    `DELETE FROM code_chunks WHERE repository = $1 AND NOT (id = ANY($2::text[]))`,
    [repository, activeChunkIds],
  );

  const deletedCount = result.rowCount ?? 0;
  if (deletedCount > 0) console.log(`🧹 Cleaned up ${deletedCount} stale code chunks from PostgreSQL.`);
  return deletedCount;
}

export async function updateRepositoryStatus(
  repository: string,
  repoHash: string,
  totalFiles: number,
  totalChunks: number,
): Promise<void> {
  await query(
    `INSERT INTO repository_status (repository, repository_hash, total_files, total_chunks, status, last_indexed_at)
     VALUES ($1, $2, $3, $4, 'completed', NOW())
     ON CONFLICT (repository) DO UPDATE SET
       repository_hash = EXCLUDED.repository_hash, total_files = EXCLUDED.total_files,
       total_chunks = EXCLUDED.total_chunks, status = 'completed', last_indexed_at = NOW()`,
    [repository, repoHash, totalFiles, totalChunks],
  );
}

export async function upsertChunks(
  repository: string,
  chunks: CodeChunk[],
  repositoryHash = "",
  totalFiles = 0,
): Promise<UpsertResultStats> {
  console.log(`💾 Processing ${chunks.length} chunks for PostgreSQL + pgvector...`);

  const activeChunkIds = chunks.map((c) => c.id);
  const deletedStale = await deleteStaleChunks(repository, activeChunkIds);

  const existingRows = await query<{ id: string; content_hash: string }>(
    `SELECT id, content_hash FROM code_chunks WHERE repository = $1`,
    [repository],
  );

  const existingHashMap = new Map(
    existingRows.rows.filter((r) => r.content_hash).map((r) => [r.id, r.content_hash]),
  );

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const chunk of chunks) {
    if (!chunk.content.trim()) continue;

    const currentHash = computeContentHash(chunk.content);
    const storedHash = existingHashMap.get(chunk.id);

    if (storedHash === currentHash) {
      skipped++;
      continue;
    }

    const embedding = await embedText(
      [`Type: ${chunk.type}`, `Name: ${chunk.name ?? ""}`, `File: ${chunk.filePath}`, "", chunk.content].join("\n"),
    );

    await query(
      `INSERT INTO code_chunks (id, repository, file_path, chunk_type, name, language, start_line, end_line, content, metadata, embedding, content_hash, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::vector, $12, NOW())
       ON CONFLICT (id) DO UPDATE SET
         repository = EXCLUDED.repository, file_path = EXCLUDED.file_path, chunk_type = EXCLUDED.chunk_type,
         name = EXCLUDED.name, language = EXCLUDED.language, start_line = EXCLUDED.start_line,
         end_line = EXCLUDED.end_line, content = EXCLUDED.content, metadata = EXCLUDED.metadata,
         embedding = EXCLUDED.embedding, content_hash = EXCLUDED.content_hash, updated_at = NOW()`,
      [
        chunk.id, repository, chunk.filePath, chunk.type, chunk.name ?? null,
        chunk.language, chunk.startLine, chunk.endLine, chunk.content,
        JSON.stringify(chunk.metadata), `[${embedding.join(",")}]`, currentHash,
      ],
    );

    storedHash !== undefined ? updated++ : inserted++;
  }

  await updateRepositoryStatus(repository, repositoryHash, totalFiles, chunks.length);

  console.log(
    `✓ Incremental indexing finished: ${inserted} inserted, ${updated} updated, ${skipped} skipped, ${deletedStale} stale deleted (total ${chunks.length}).`,
  );

  return { inserted, updated, skipped, deletedStale, total: chunks.length };
}

export async function pgVectorSearch(
  queryText: string,
  filterOrRepo?: string | VectorSearchFilterOptions,
  limitParam = 10,
): Promise<VectorSearchResult[]> {
  const options: VectorSearchFilterOptions =
    typeof filterOrRepo === "string"
      ? { repository: filterOrRepo, limit: limitParam }
      : filterOrRepo ?? { limit: limitParam };

  if (!options.repository) {
    throw new Error("Security Error: Repository scope is required for vector search.");
  }

  const queryEmbedding = await embedText(queryText);
  const vectorString = `[${queryEmbedding.join(",")}]`;
  const limit = options.limit ?? 10;

  let sql = `
    SELECT id, file_path, chunk_type, name, language, start_line, end_line,
           content, metadata, 1 - (embedding <=> $1::vector) AS similarity
    FROM code_chunks
  `;

  const whereConditions: string[] = [];
  const params: unknown[] = [vectorString];

  params.push(options.repository);
  whereConditions.push(`repository = $${params.length}`);

  if (options.language) {
    params.push(options.language);
    whereConditions.push(`language = $${params.length}`);
  }

  if (options.chunkType) {
    params.push(options.chunkType);
    whereConditions.push(`chunk_type = $${params.length}`);
  }

  if (options.filePathPrefix) {
    params.push(`${options.filePathPrefix}%`);
    whereConditions.push(`file_path LIKE $${params.length}`);
  }

  if (options.metadata && Object.keys(options.metadata).length > 0) {
    params.push(JSON.stringify(options.metadata));
    whereConditions.push(`metadata @> $${params.length}::jsonb`);
  }

  if (whereConditions.length > 0) {
    sql += ` WHERE ` + whereConditions.join(" AND ");
  }

  params.push(limit);
  sql += ` ORDER BY embedding <=> $1::vector ASC LIMIT $${params.length}`;

  const result = await query<StoredChunkRow>(sql, params);

  return result.rows.map((row) => ({
    chunk: {
      id: row.id,
      type: row.chunk_type as any,
      filePath: row.file_path,
      language: row.language as any,
      name: row.name ?? undefined,
      startLine: row.start_line,
      endLine: row.end_line,
      content: row.content,
      metadata: row.metadata as any,
    },
    score: Number(row.similarity ?? 0),
  }));
}
