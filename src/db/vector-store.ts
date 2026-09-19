import crypto from "node:crypto";
import type { CodeChunk } from "../ingestion/chunker.js";
import { embedText } from "../ingestion/embedder.js";
import { getCollection, type DatabaseHealthStatus, getDatabaseHealth } from "./mongodb.js";
import type { VectorSearchResult } from "../retrieval/vector-search.js";

export interface ChunkMetadata {
  fileName: string;
  directory: string;
  imports: string[];
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

const CODE_CHUNKS = "code_chunks";
const REPO_STATUS = "repository_status";

const computeContentHash = (content: string): string => crypto.createHash("sha256").update(content).digest("hex");

const buildEmbeddingText = (chunk: CodeChunk): string =>
  [`Type: ${chunk.type}`, `Name: ${chunk.name ?? ""}`, `File: ${chunk.filePath}`, "", chunk.content].join("\n");

/** Cosine similarity between two vectors */
const cosineSimilarity = (a: number[], b: number[]): number => {
  let dot = 0,
    normA = 0,
    normB = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i]!;
    const bi = b[i]!;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
};

const mapDocToResult = (doc: Record<string, unknown>, score: number): VectorSearchResult => ({
  chunk: {
    id: doc.chunk_id as string,
    type: doc.chunk_type as CodeChunk["type"],
    filePath: doc.file_path as string,
    language: doc.language as CodeChunk["language"],
    name: (doc.name as string) ?? undefined,
    startLine: doc.start_line as number,
    endLine: doc.end_line as number,
    content: doc.content as string,
    metadata: doc.metadata as ChunkMetadata,
  },
  score,
});

export const deleteStaleChunks = async (repository: string, activeChunkIds: string[]): Promise<number> => {
  const col = getCollection(CODE_CHUNKS);
  const filter: Record<string, unknown> = { repository };
  if (activeChunkIds.length > 0) {
    filter.chunk_id = { $nin: activeChunkIds };
  }
  const result = await col.deleteMany(filter);
  const deletedCount = result.deletedCount;
  if (deletedCount > 0) console.warn(`Cleaned up ${deletedCount} stale code chunks from MongoDB.`);
  return deletedCount;
};

export const updateRepositoryStatus = async (
  repository: string,
  repoHash: string,
  totalFiles: number,
  totalChunks: number,
): Promise<void> => {
  const col = getCollection(REPO_STATUS);
  await col.updateOne(
    { repository },
    {
      $set: {
        repository_hash: repoHash,
        total_files: totalFiles,
        total_chunks: totalChunks,
        status: "completed",
        last_indexed_at: new Date().toISOString(),
      },
    },
    { upsert: true },
  );
};

export const upsertChunks = async (
  repository: string,
  chunks: CodeChunk[],
  repositoryHash = "",
  totalFiles = 0,
): Promise<UpsertResultStats> => {
  console.warn(`Processing ${chunks.length} chunks for MongoDB vector store...`);

  const activeChunkIds = chunks.map(({ id }) => id);
  const deletedStale = await deleteStaleChunks(repository, activeChunkIds);

  const col = getCollection(CODE_CHUNKS);
  const existingRows = await col.find({ repository }, { projection: { chunk_id: 1, content_hash: 1 } }).toArray();

  const existingHashMap = new Map<string, string>();
  for (const r of existingRows) {
    const chunkId = r.chunk_id as unknown;
    const hash = r.content_hash as unknown;
    if (typeof chunkId === "string" && typeof hash === "string") {
      existingHashMap.set(chunkId, hash);
    }
  }

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

    const embedding = embedText(buildEmbeddingText(chunk));

    const doc: Record<string, unknown> = {
      chunk_id: chunk.id,
      repository,
      file_path: chunk.filePath,
      chunk_type: chunk.type,
      name: chunk.name ?? null,
      language: chunk.language,
      start_line: chunk.startLine,
      end_line: chunk.endLine,
      content: chunk.content,
      metadata: chunk.metadata,
      embedding,
      content_hash: currentHash,
      updated_at: new Date().toISOString(),
    };

    if (storedHash !== undefined) {
      updated++;
    } else {
      inserted++;
    }

    await col.updateOne({ chunk_id: chunk.id }, { $set: doc }, { upsert: true });
  }

  await updateRepositoryStatus(repository, repositoryHash, totalFiles, chunks.length);

  console.warn(
    `Incremental indexing finished: ${inserted} inserted, ${updated} updated, ${skipped} skipped, ${deletedStale} stale deleted (total ${chunks.length}).`,
  );

  return { inserted, updated, skipped, deletedStale, total: chunks.length };
};

/**
 * MongoDB Atlas Vector similarity search.
 * Attempts Atlas Vector Search ($vectorSearch) first; falls back to application-level
 * cosine similarity for local MongoDB instances.
 */
export const mongoVectorSearch = async (
  queryText: string,
  filterOrRepo?: string | VectorSearchFilterOptions,
  limitParam = 10,
): Promise<VectorSearchResult[]> => {
  const options: VectorSearchFilterOptions =
    typeof filterOrRepo === "string"
      ? { repository: filterOrRepo, limit: limitParam }
      : (filterOrRepo ?? { limit: limitParam });

  if (!options.repository) {
    throw new Error("Security Error: Repository scope is required for vector search.");
  }

  const queryEmbedding = embedText(queryText);
  const limit = options.limit ?? 10;

  // Build MongoDB filter
  const filter: Record<string, unknown> = { repository: options.repository };
  if (options.language) filter.language = options.language;
  if (options.chunkType) filter.chunk_type = options.chunkType;
  if (options.filePathPrefix)
    filter.file_path = { $regex: `^${options.filePathPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}` };
  if (options.metadata && Object.keys(options.metadata).length > 0) {
    for (const [key, value] of Object.entries(options.metadata)) {
      filter[`metadata.${key}`] = value;
    }
  }

  // Try Atlas Vector Search first
  try {
    const col = getCollection(CODE_CHUNKS);
    const pipeline = [
      { $match: filter },
      {
        $vectorSearch: {
          index: "vector_index",
          path: "embedding",
          queryVector: queryEmbedding,
          numCandidates: Math.max(limit * 10, 100),
          limit,
        },
      },
      {
        $addFields: {
          similarity: { $meta: "vectorSearchScore" },
        },
      },
    ];

    const results = await col.aggregate(pipeline).toArray();
    return results.map((doc: Record<string, unknown>) => mapDocToResult(doc, (doc.similarity as number) ?? 0));
  } catch {
    // Atlas Vector Search not available — fall back to application-level cosine similarity
  }

  // Fallback: application-level cosine similarity search
  const col = getCollection(CODE_CHUNKS);
  const candidates = await col.find(filter).limit(500).toArray();

  interface ScoredCandidate {
    doc: Record<string, unknown>;
    similarity: number;
  }

  const scored: ScoredCandidate[] = [];
  for (const doc of candidates) {
    const emb = doc.embedding as number[] | undefined;
    if (!emb || emb.length === 0) continue;
    const similarity = cosineSimilarity(queryEmbedding, emb);
    scored.push({ doc, similarity });
  }

  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, limit).map(({ doc, similarity }) => mapDocToResult(doc, similarity));
};

export const vectorSearch = mongoVectorSearch;
/** @deprecated Use mongoVectorSearch or vectorSearch instead */
export const pgVectorSearch = mongoVectorSearch;

export { type DatabaseHealthStatus };
export { getDatabaseHealth };
