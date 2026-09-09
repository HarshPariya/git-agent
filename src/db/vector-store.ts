import crypto from "node:crypto";
import type { CodeChunk } from "../ingestion/chunker.js";
import { embedText } from "../ingestion/embedder.js";
import { query } from "./postgres.js";
import type { VectorSearchResult } from "../retrieval/vector-search.js";

export interface ChunkMetadata {
  fileName: string;
  directory: string;
  imports: string[];
}

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
  metadata: ChunkMetadata;
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

const formatEmbedding = (embedding: number[]): string => `[${embedding.join(",")}]`;

const buildEmbeddingText = (chunk: CodeChunk): string =>
  [`Type: ${chunk.type}`, `Name: ${chunk.name ?? ""}`, `File: ${chunk.filePath}`, "", chunk.content].join("\n");

const UPSERT_CHUNK_SQL = `
  INSERT INTO code_chunks (id, repository, file_path, chunk_type, name, language, start_line, end_line, content, metadata, embedding, content_hash, updated_at)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::vector, $12, NOW())
  ON CONFLICT (id) DO UPDATE SET
    repository = EXCLUDED.repository, file_path = EXCLUDED.file_path, chunk_type = EXCLUDED.chunk_type,
    name = EXCLUDED.name, language = EXCLUDED.language, start_line = EXCLUDED.start_line,
    end_line = EXCLUDED.end_line, content = EXCLUDED.content, metadata = EXCLUDED.metadata,
    embedding = EXCLUDED.embedding, content_hash = EXCLUDED.content_hash, updated_at = NOW()`;

const buildChunkParams = (chunk: CodeChunk, embedding: number[], hash: string, repository: string): unknown[] => [
  chunk.id, repository, chunk.filePath, chunk.type, chunk.name ?? null,
  chunk.language, chunk.startLine, chunk.endLine, chunk.content,
  JSON.stringify(chunk.metadata), formatEmbedding(embedding), hash,
];

const mapRowToResult = (row: StoredChunkRow): VectorSearchResult => ({
  chunk: {
    id: row.id,
    type: row.chunk_type as CodeChunk["type"],
    filePath: row.file_path,
    language: row.language as CodeChunk["language"],
    name: row.name ?? undefined,
    startLine: row.start_line,
    endLine: row.end_line,
    content: row.content,
    metadata: row.metadata,
  },
  score: Number(row.similarity ?? 0),
});

export const deleteStaleChunks = async (
  repository: string,
  activeChunkIds: string[],
): Promise<number> => {
  const sql = activeChunkIds.length === 0
    ? `DELETE FROM code_chunks WHERE repository = $1`
    : `DELETE FROM code_chunks WHERE repository = $1 AND NOT (id = ANY($2::text[]))`;

  const params = activeChunkIds.length === 0
    ? [repository]
    : [repository, activeChunkIds];

  const { rowCount } = await query(sql, params);
  const deletedCount = rowCount ?? 0;
  if (deletedCount > 0) console.log(`Cleaned up ${deletedCount} stale code chunks from PostgreSQL.`);
  return deletedCount;
};

export const updateRepositoryStatus = async (
  repository: string,
  repoHash: string,
  totalFiles: number,
  totalChunks: number,
): Promise<void> => {
  await query(
    `INSERT INTO repository_status (repository, repository_hash, total_files, total_chunks, status, last_indexed_at)
     VALUES ($1, $2, $3, $4, 'completed', NOW())
     ON CONFLICT (repository) DO UPDATE SET
       repository_hash = EXCLUDED.repository_hash, total_files = EXCLUDED.total_files,
       total_chunks = EXCLUDED.total_chunks, status = 'completed', last_indexed_at = NOW()`,
    [repository, repoHash, totalFiles, totalChunks],
  );
};

export const upsertChunks = async (
  repository: string,
  chunks: CodeChunk[],
  repositoryHash = "",
  totalFiles = 0,
): Promise<UpsertResultStats> => {
  console.log(`Processing ${chunks.length} chunks for PostgreSQL + pgvector...`);

  const activeChunkIds = chunks.map(({ id }) => id);
  const deletedStale = await deleteStaleChunks(repository, activeChunkIds);

  const { rows: existingRows } = await query<{ id: string; content_hash: string }>(
    `SELECT id, content_hash FROM code_chunks WHERE repository = $1`,
    [repository],
  );

  const existingHashMap = new Map(
    existingRows.filter(({ content_hash }) => content_hash).map(({ id, content_hash }) => [id, content_hash]),
  );

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const chunk of chunks) {
    if (!chunk.content.trim()) continue;

    const currentHash = computeContentHash(chunk.content);
    const storedHash = existingHashMap.get(chunk.id);

    if (storedHash === currentHash) { skipped++; continue; }

    const embedding = embedText(buildEmbeddingText(chunk));
    await query(UPSERT_CHUNK_SQL, buildChunkParams(chunk, embedding, currentHash, repository));
    if (storedHash !== undefined) { updated++; } else { inserted++; }
  }

  await updateRepositoryStatus(repository, repositoryHash, totalFiles, chunks.length);

  console.log(
    `Incremental indexing finished: ${inserted} inserted, ${updated} updated, ${skipped} skipped, ${deletedStale} stale deleted (total ${chunks.length}).`,
  );

  return { inserted, updated, skipped, deletedStale, total: chunks.length };
};

const buildFilterConditions = (repository: string, options: VectorSearchFilterOptions, startIdx = 2): { sql: string; params: unknown[] } => {
  const params: unknown[] = [repository];
  const conditions: string[] = [`repository = $${startIdx}`];
  let nextIdx = startIdx + 1;

  const addCondition = (clause: string, value: unknown) => {
    params.push(value);
    conditions.push(`${clause} $${nextIdx++}`);
  };

  if (options.language) addCondition("language =", options.language);
  if (options.chunkType) addCondition("chunk_type =", options.chunkType);
  if (options.filePathPrefix) addCondition("file_path LIKE", `${options.filePathPrefix}%`);
  if (options.metadata && Object.keys(options.metadata).length > 0) {
    params.push(JSON.stringify(options.metadata));
    conditions.push(`metadata @> $${nextIdx++}::jsonb`);
  }

  return {
    sql: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "",
    params,
  };
};

const VECTOR_SEARCH_SQL = `
  SELECT id, file_path, chunk_type, name, language, start_line, end_line,
         content, metadata, 1 - (embedding <=> $1::vector) AS similarity
  FROM code_chunks`;

export const pgVectorSearch = async (
  queryText: string,
  filterOrRepo?: string | VectorSearchFilterOptions,
  limitParam = 10,
): Promise<VectorSearchResult[]> => {
  const options: VectorSearchFilterOptions =
    typeof filterOrRepo === "string"
      ? { repository: filterOrRepo, limit: limitParam }
      : filterOrRepo ?? { limit: limitParam };

  if (!options.repository) {
    throw new Error("Security Error: Repository scope is required for vector search.");
  }

  const queryEmbedding = embedText(queryText);
  const vectorString = formatEmbedding(queryEmbedding);
  const limit = options.limit ?? 10;

  const { sql: whereClause, params: filterParams } = buildFilterConditions(options.repository, options);

  const allParams: unknown[] = [vectorString, ...filterParams];
  allParams.push(limit);

  const fullSql = `${VECTOR_SEARCH_SQL} ${whereClause} ORDER BY embedding <=> $1::vector ASC LIMIT $${allParams.length}`;

  const { rows } = await query<StoredChunkRow>(fullSql, allParams);
  return rows.map(mapRowToResult);
};
