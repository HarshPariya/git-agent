import type { CodeChunk } from "../ingestion/chunker.js";
import { embedText } from "../ingestion/embedder.js";

export interface VectorDocument {
  chunk: CodeChunk;
  embedding: number[];
}

export interface VectorSearchResult {
  chunk: CodeChunk;
  score: number;
}

const cosineSimilarity = (a: number[], b: number[]): number => {
  if (a.length !== b.length) return 0;

  const { dot, magA, magB } = a.reduce(
    (acc, valA, i) => {
      const valB = b[i] ?? 0;
      return {
        dot: acc.dot + valA * valB,
        magA: acc.magA + valA * valA,
        magB: acc.magB + valB * valB,
      };
    },
    { dot: 0, magA: 0, magB: 0 }
  );

  return magA === 0 || magB === 0 ? 0 : dot / (Math.sqrt(magA) * Math.sqrt(magB));
};

export const buildVectorIndex = (chunks: CodeChunk[]): VectorDocument[] => {
  const documents: VectorDocument[] = [];

  for (const chunk of chunks) {
    if (!chunk.content.trim()) continue;

    try {
      const embedding = embedText([
        `Type: ${chunk.type}`,
        `Name: ${chunk.name ?? ""}`,
        `File: ${chunk.filePath}`,
        "",
        chunk.content,
      ].join("\n"));
      documents.push({ chunk, embedding });
    } catch (err: unknown) {
      console.warn(`Failed to embed chunk ${chunk.name ?? chunk.filePath}:`, err);
    }
  }

  return documents;
};

export const vectorSearch = (
  query: string,
  index: VectorDocument[],
  limit = 10
): VectorSearchResult[] => {
  const queryEmbedding = embedText(query);

  return index
    .map((document) => ({
      chunk: document.chunk,
      score: cosineSimilarity(queryEmbedding, document.embedding),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
};
