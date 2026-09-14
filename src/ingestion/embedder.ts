export interface EmbeddingMetrics {
  modelLoadTimeMs: number;
  totalEmbeddings: number;
  failedEmbeddings: number;
  totalEmbeddingTimeMs: number;
}

const DIMENSIONS = 384;

const metrics: EmbeddingMetrics = {
  modelLoadTimeMs: 0,
  totalEmbeddings: 0,
  failedEmbeddings: 0,
  totalEmbeddingTimeMs: 0,
};

const hashFeature = (feature: string): number => {
  let hash = 2166136261;
  for (let i = 0; i < feature.length; i++) {
    hash ^= feature.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const createEmbedding = (text: string): number[] => {
  const vector = new Array<number>(DIMENSIONS).fill(0);
  const words = text.toLowerCase().replace(/[^a-z0-9_$.-]+/g, " ").trim().split(/\s+/).filter(Boolean);

  const features = [
    ...words.map((w) => `word:${w}`),
    ...words.slice(0, -1).map((w, i) => `pair:${w}_${words[i + 1]}`),
    ...words.filter((w) => w.length >= 3).flatMap((w) => Array.from({ length: w.length - 2 }, (_, i) => `tri:${w.slice(i, i + 3)}`)),
  ];

  for (const feature of features) {
    const hash = hashFeature(feature);
    const bucket = hash % DIMENSIONS;
    vector[bucket] = (vector[bucket] ?? 0) + ((hash & 0x80000000) === 0 ? 1 : -1);
  }

  const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  return magnitude === 0 ? vector : vector.map((v) => v / magnitude);
};

export const getExtractor = (): (text: string) => number[] => createEmbedding;

export interface EmbedOptions {
  maxRetries?: number;
  timeoutMs?: number;
  backoffMs?: number;
}

export const embedText = (text: string, _options: EmbedOptions = {}): number[] => {
  const startTime = Date.now();
  try {
    const embedding = createEmbedding(text);
    metrics.totalEmbeddings++;
    metrics.totalEmbeddingTimeMs += Date.now() - startTime;
    return embedding;
  } catch (err) {
    metrics.failedEmbeddings++;
    throw err instanceof Error ? err : new Error(String(err));
  }
};

export interface EmbeddedChunk {
  id: string;
  embedding: number[];
}

export const embedChunks = (chunks: { id: string; content: string }[], options?: EmbedOptions): EmbeddedChunk[] =>
  chunks.map((chunk) => ({
    id: chunk.id,
    embedding: embedText(chunk.content, options),
  }));

export const getEmbeddingMetrics = () => ({
  modelLoadTimeMs: metrics.modelLoadTimeMs,
  totalEmbeddings: metrics.totalEmbeddings,
  failedEmbeddings: metrics.failedEmbeddings,
  averageLatencyMs: metrics.totalEmbeddings > 0 ? Math.round(metrics.totalEmbeddingTimeMs / metrics.totalEmbeddings) : 0,
});
