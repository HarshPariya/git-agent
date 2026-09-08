import { query } from "./postgres.js";

export interface HnswTuningOptions {
  efSearch?: number;
  m?: number;
  efConstruction?: number;
}

const DEFAULT_M = 16;
const DEFAULT_EF_CONSTRUCTION = 64;
const DEFAULT_EF_SEARCH = 100;

export const setHnswSearchPrecision = async (efSearch = DEFAULT_EF_SEARCH): Promise<void> => {
  await query(`SET LOCAL hnsw.ef_search = ${Math.floor(efSearch)};`);
};

export const rebuildHnswIndex = async (
  options: HnswTuningOptions = {},
): Promise<void> => {
  const m = options.m ?? DEFAULT_M;
  const efConstruction = options.efConstruction ?? DEFAULT_EF_CONSTRUCTION;

  console.log(`Tuning HNSW index parameters (m=${m}, ef_construction=${efConstruction})...`);

  await query(`DROP INDEX IF EXISTS idx_code_chunks_embedding_hnsw;`);
  await query(`
    CREATE INDEX idx_code_chunks_embedding_hnsw
    ON code_chunks
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = ${m}, ef_construction = ${efConstruction});
  `);

  console.log("HNSW index successfully tuned and rebuilt.");
};
