import { pipeline } from "@xenova/transformers";

export type EmbeddingErrorCode =
  | "MODEL_LOAD_FAILED"
  | "EMBEDDING_TIMEOUT"
  | "EMBEDDING_FAILED"
  | "UNINITIALIZED";

export class EmbeddingError extends Error {
  public readonly code: EmbeddingErrorCode;
  public readonly originalError?: unknown;

  constructor(
    message: string,
    code: EmbeddingErrorCode,
    originalError?: unknown,
  ) {
    super(message);
    this.name = "EmbeddingError";
    this.code = code;
    this.originalError = originalError;
  }
}

export interface EmbeddingMetrics {
  modelLoadTimeMs: number;
  totalEmbeddings: number;
  failedEmbeddings: number;
  totalEmbeddingTimeMs: number;
}

const metrics: EmbeddingMetrics = {
  modelLoadTimeMs: 0,
  totalEmbeddings: 0,
  failedEmbeddings: 0,
  totalEmbeddingTimeMs: 0,
};

let extractorPromise: Promise<any> | null = null;

export async function getExtractor(): Promise<any> {
  if (!extractorPromise) {
    const startTime = Date.now();
    extractorPromise = (async () => {
      try {
        console.log("⚡ Loading embedding model (Xenova/all-MiniLM-L6-v2)...");
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(
            () =>
              reject(
                new EmbeddingError(
                  "Embedding model initialization timed out (30s limit)",
                  "MODEL_LOAD_FAILED",
                ),
              ),
            30000,
          ),
        );

        const model = await Promise.race([
          pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2"),
          timeoutPromise,
        ]);

        metrics.modelLoadTimeMs = Date.now() - startTime;
        console.log(`✓ Embedding model loaded successfully in ${metrics.modelLoadTimeMs}ms.`);
        return model;
      } catch (err: any) {
        extractorPromise = null; // Clear so subsequent calls can retry initialization
        if (err instanceof EmbeddingError) {
          throw err;
        }
        throw new EmbeddingError(
          `Embedding model load failed: ${err?.message ?? err}`,
          "MODEL_LOAD_FAILED",
          err,
        );
      }
    })();
  }

  return extractorPromise;
}

export interface EmbedOptions {
  maxRetries?: number;
  timeoutMs?: number;
  backoffMs?: number;
}

export async function embedText(
  text: string,
  options: EmbedOptions = {},
): Promise<number[]> {
  const maxRetries = options.maxRetries ?? 3;
  const timeoutMs = options.timeoutMs ?? 10000;
  const backoffMs = options.backoffMs ?? 250;

  let attempt = 0;
  const startTime = Date.now();

  while (true) {
    attempt++;
    try {
      const model = await getExtractor();

      const modelPromise = model(text, {
        pooling: "mean",
        normalize: true,
      });

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(
          () =>
            reject(
              new EmbeddingError(
                `Embedding generation timed out after ${timeoutMs}ms`,
                "EMBEDDING_TIMEOUT",
              ),
            ),
          timeoutMs,
        ),
      );

      const output: any = await Promise.race([modelPromise, timeoutPromise]);
      const duration = Date.now() - startTime;

      metrics.totalEmbeddings++;
      metrics.totalEmbeddingTimeMs += duration;

      return Array.from(output.data);
    } catch (err: any) {
      if (attempt >= maxRetries) {
        metrics.failedEmbeddings++;
        if (err instanceof EmbeddingError) {
          throw err;
        }
        throw new EmbeddingError(
          `Embedding failed after ${maxRetries} attempts: ${err?.message ?? err}`,
          "EMBEDDING_FAILED",
          err,
        );
      }

      console.warn(
        `⚠️ Embedding attempt ${attempt}/${maxRetries} failed (${err?.message}). Retrying in ${backoffMs * attempt}ms...`,
      );
      await new Promise((res) => setTimeout(res, backoffMs * attempt));
    }
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
  const results: EmbeddedChunk[] = [];

  for (const chunk of chunks) {
    const embedding = await embedText(chunk.content, options);
    results.push({
      id: chunk.id,
      embedding,
    });
  }

  return results;
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
