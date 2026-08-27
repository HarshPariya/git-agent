import type {
  CodeChunk,
} from "../ingestion/chunker.js";

import {
  embedText,
} from "../ingestion/embedder.js";

export interface VectorDocument {
  chunk: CodeChunk;
  embedding: number[];
}

export interface VectorSearchResult {
  chunk: CodeChunk;
  score: number;
}

function cosineSimilarity(
  a: number[],
  b: number[],
): number {
  if (a.length !== b.length) {
    return 0;
  }

  let dot = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;

  for (let index = 0; index < a.length; index++) {
    const valA = a[index] ?? 0;
    const valB = b[index] ?? 0;

    dot += valA * valB;
    magnitudeA += valA * valA;
    magnitudeB += valB * valB;
  }

  if (
    magnitudeA === 0 ||
    magnitudeB === 0
  ) {
    return 0;
  }

  return (
    dot /
    (
      Math.sqrt(magnitudeA) *
      Math.sqrt(magnitudeB)
    )
  );
}

export async function buildVectorIndex(
  chunks: CodeChunk[],
): Promise<VectorDocument[]> {
  const documents: VectorDocument[] = [];

  for (const chunk of chunks) {
    if (!chunk.content.trim()) {
      continue;
    }

    const embedding =
      await embedText(
        [
          `Type: ${chunk.type}`,
          `Name: ${chunk.name ?? ""}`,
          `File: ${chunk.filePath}`,
          "",
          chunk.content,
        ].join("\n"),
      );

    documents.push({
      chunk,
      embedding,
    });
  }

  return documents;
}

export async function vectorSearch(
  query: string,
  index: VectorDocument[],
  limit = 10,
): Promise<VectorSearchResult[]> {
  const queryEmbedding =
    await embedText(query);

  return index
    .map((document) => ({
      chunk: document.chunk,

      score: cosineSimilarity(
        queryEmbedding,
        document.embedding,
      ),
    }))
    .sort(
      (a, b) =>
        b.score - a.score,
    )
    .slice(0, limit);
}
