import "dotenv/config";

const envInt = (key: string, def: string): number => Number.parseInt(process.env[key] ?? def, 10);

const MB = 1024 * 1024;
const KB = 1024;

export const LIMITS = Object.freeze({
  maxQueryLength: envInt("MAX_QUERY_LENGTH", "2000"),
  maxResults: envInt("MAX_RESULTS", "50"),
  defaultResults: envInt("DEFAULT_RESULTS", "10"),
  maxFileSizeBytes: envInt("MAX_FILE_SIZE_BYTES", `${1 * MB}`),
  maxChunkSizeBytes: envInt("MAX_CHUNK_SIZE_BYTES", `${32 * KB}`),
  maxRepositoryFiles: envInt("MAX_REPOSITORY_FILES", "10000"),
  maxRepositorySizeBytes: envInt("MAX_REPOSITORY_SIZE_BYTES", `${500 * MB}`),
  maxRepositoryChunks: envInt("MAX_REPOSITORY_CHUNKS", "100000"),
  maxGraphDepth: envInt("MAX_GRAPH_DEPTH", "5"),
  maxGraphNodesVisited: envInt("MAX_GRAPH_NODES_VISITED", "1000"),
});
