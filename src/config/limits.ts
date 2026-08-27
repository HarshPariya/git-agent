import "dotenv/config";

export const LIMITS = {
  maxQueryLength: Number.parseInt(process.env.MAX_QUERY_LENGTH ?? "2000", 10),
  maxResults: Number.parseInt(process.env.MAX_RESULTS ?? "50", 10),
  defaultResults: Number.parseInt(process.env.DEFAULT_RESULTS ?? "10", 10),
  maxFileSizeBytes: Number.parseInt(
    process.env.MAX_FILE_SIZE_BYTES ?? `${1 * 1024 * 1024}`,
    10,
  ), // 1 MB
  maxChunkSizeBytes: Number.parseInt(
    process.env.MAX_CHUNK_SIZE_BYTES ?? `${32 * 1024}`,
    10,
  ), // 32 KB
  maxRepositoryFiles: Number.parseInt(
    process.env.MAX_REPOSITORY_FILES ?? "10000",
    10,
  ),
  maxRepositorySizeBytes: Number.parseInt(
    process.env.MAX_REPOSITORY_SIZE_BYTES ?? `${500 * 1024 * 1024}`,
    10,
  ), // 500 MB
  maxRepositoryChunks: Number.parseInt(
    process.env.MAX_REPOSITORY_CHUNKS ?? "100000",
    10,
  ),
  maxGraphDepth: Number.parseInt(process.env.MAX_GRAPH_DEPTH ?? "5", 10),
  maxGraphNodesVisited: Number.parseInt(
    process.env.MAX_GRAPH_NODES_VISITED ?? "1000",
    10,
  ),
} as const;
