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

function hashFeature(feature: string): number {
  let hash = 2166136261;
  for (let index = 0; index < feature.length; index++) {
    hash ^= feature.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createEmbedding(text: string): number[] {
  const vector = new Array<number>(DIMENSIONS).fill(0);
  const normalized = text.toLowerCase().replace(/[^a-z0-9_$.-]+/g, " ").trim();
  const words = normalized.split(/\s+/).filter(Boolean);
  const features = [
    ...words.map((word) => `word:${word}`),
    ...words.slice(0, -1).map((word, index) => `pair:${word}_${words[index + 1]}`),
  ];

  for (const word of words) {
    if (word.length < 3) continue;
    for (let index = 0; index <= word.length - 3; index++) {
      features.push(`tri:${word.slice(index, index + 3)}`);
    }
  }

  for (const feature of features) {
    const hash = hashFeature(feature);
    const bucket = hash % DIMENSIONS;
    vector[bucket] = (vector[bucket] ?? 0) + ((hash & 0x80000000) === 0 ? 1 : -1);
  }

  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (magnitude === 0) return vector;
  return vector.map((value) => value / magnitude);
}

/** Compatibility hook for callers that previously loaded a transformer pipeline. */
export async function getExtractor(): Promise<(text: string) => number[]> {
  return createEmbedding;
}

export interface EmbedOptions {
  maxRetries?: number;
  timeoutMs?: number;
  backoffMs?: number;
}

export async function embedText(text: string, _options: EmbedOptions = {}): Promise<number[]> {
  const startTime = Date.now();
  try {
    const embedding = createEmbedding(text);
    metrics.totalEmbeddings++;
    metrics.totalEmbeddingTimeMs += Date.now() - startTime;
    return embedding;
  } catch (error) {
    metrics.failedEmbeddings++;
    throw error;
  }
}

export interface EmbeddedChunk {
  id: string;
  embedding: number[];
}

export async function embedChunks(
  chunks: { id: string; content: string }[],
  options?: EmbedOptions,
): Promise<EmbeddedChunk[]> {
  return Promise.all(
    chunks.map(async (chunk) => ({
      id: chunk.id,
      embedding: await embedText(chunk.content, options),
    })),
  );
}

export function getEmbeddingMetrics() {
  return {
    modelLoadTimeMs: metrics.modelLoadTimeMs,
    totalEmbeddings: metrics.totalEmbeddings,
    failedEmbeddings: metrics.failedEmbeddings,
    averageLatencyMs:
      metrics.totalEmbeddings > 0
        ? Math.round(metrics.totalEmbeddingTimeMs / metrics.totalEmbeddings)
        : 0,
  };
}
