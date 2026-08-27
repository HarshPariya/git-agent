import { query } from "./postgres.js";

export interface HnswTuningOptions {
  efSearch?: number; // Query-time search depth (default 100)
  m?: number;        // Max connections per layer (default 16)
  efConstruction?: number; // Construction precision (default 64)
}

export async function setHnswSearchPrecision(efSearch = 100): Promise<void> {
  await query(`SET LOCAL hnsw.ef_search = ${Math.floor(efSearch)};`);
}

export async function rebuildHnswIndex(
  options: HnswTuningOptions = {},
): Promise<void> {
  const m = options.m ?? 16;
  const efConstruction = options.efConstruction ?? 64;

  console.log(`⚙ Tuning HNSW index parameters (m=${m}, ef_construction=${efConstruction})...`);

  await query(`DROP INDEX IF EXISTS idx_code_chunks_embedding_hnsw;`);

  await query(`
    CREATE INDEX idx_code_chunks_embedding_hnsw
    ON code_chunks
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = ${m}, ef_construction = ${efConstruction});
  `);

  console.log("✓ HNSW index successfully tuned and rebuilt.");
}
