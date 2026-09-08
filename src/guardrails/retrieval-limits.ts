import { LIMITS } from "../config/limits.js";

export class ResourceLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResourceLimitError";
  }
}

export function validateQueryLength(query: string): string {
  if (!query || typeof query !== "string") throw new ResourceLimitError("Query must be a non-empty string.");
  const trimmed = query.trim();
  if (trimmed.length === 0) throw new ResourceLimitError("Query cannot be empty or blank.");
  if (trimmed.length > LIMITS.maxQueryLength)
    throw new ResourceLimitError(`Query length (${trimmed.length} chars) exceeds maximum limit of ${LIMITS.maxQueryLength} characters.`);
  return trimmed;
}

export function validateTopK(limit?: number): number {
  if (limit === undefined || limit === null) return LIMITS.defaultResults;
  if (typeof limit !== "number" || Number.isNaN(limit) || !Number.isFinite(limit))
    throw new ResourceLimitError("Limit must be a valid finite number.");
  if (limit <= 0) throw new ResourceLimitError("Limit must be a positive integer greater than 0.");
  if (limit > LIMITS.maxResults)
    throw new ResourceLimitError(`Requested limit (${limit}) exceeds maximum result limit of ${LIMITS.maxResults}.`);
  return Math.floor(limit);
}

export function validateChunkContentSize(content: string): string {
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > LIMITS.maxChunkSizeBytes) {
    console.warn(`Truncated chunk content exceeding ${LIMITS.maxChunkSizeBytes} bytes (original: ${bytes} bytes)`);
    return content.slice(0, LIMITS.maxChunkSizeBytes);
  }
  return content;
}

export function validateRepositoryScan(fileCount: number, totalSizeBytes: number): void {
  if (fileCount > LIMITS.maxRepositoryFiles)
    throw new ResourceLimitError(`Repository file count (${fileCount}) exceeds limit of ${LIMITS.maxRepositoryFiles} files.`);
  if (totalSizeBytes > LIMITS.maxRepositorySizeBytes)
    throw new ResourceLimitError(`Repository total size (${(totalSizeBytes / 1024 / 1024).toFixed(1)} MB) exceeds limit of ${LIMITS.maxRepositorySizeBytes / 1024 / 1024} MB.`);
}

export function validateRepositoryChunkCount(totalChunks: number): void {
  if (totalChunks > LIMITS.maxRepositoryChunks)
    throw new ResourceLimitError(`Repository chunk count (${totalChunks}) exceeds limit of ${LIMITS.maxRepositoryChunks} chunks.`);
}

export function validateGraphDepth(depth?: number): number {
  if (depth === undefined || depth === null || typeof depth !== "number" || Number.isNaN(depth) || depth <= 0)
    return LIMITS.maxGraphDepth;
  return Math.min(Math.floor(depth), LIMITS.maxGraphDepth);
}
