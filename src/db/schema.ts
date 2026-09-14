export const EMBEDDING_DIMENSION = 384;

export const initializeSchema = (): void => {
  // MongoDB uses schemaless collections — no migration needed.
  // Collections are created automatically on first write.
  console.warn("MongoDB: schema initialization (no-op for schemaless database).");
};
