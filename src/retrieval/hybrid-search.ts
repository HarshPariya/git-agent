import type {
  CodeGraph,
} from "../graph/graph-builder.js";

import type {
  CodeChunk,
} from "../ingestion/chunker.js";

import type {
  VectorSearchResult,
} from "./vector-search.js";

import {
  graphSearch,
} from "./graph-search.js";

export interface HybridSearchOptions {
  limit?: number | undefined;

  graphLimit?: number | undefined;

  graphMaxDepth?: number | undefined;

  vectorWeight?: number | undefined;
  graphWeight?: number | undefined;
}

export interface HybridSearchResult {
  chunk?: CodeChunk | undefined;

  name: string;
  filePath?: string | undefined;

  vectorScore: number;
  graphScore: number;

  hybridScore: number;

  sources: Array<
    "vector" | "graph"
  >;

  graphDepth?: number | undefined;

  graphMatchType?: string | undefined;
}

function normalizeVectorScores(
  results: VectorSearchResult[],
): Map<string, number> {
  const normalized =
    new Map<string, number>();

  if (results.length === 0) {
    return normalized;
  }

  const scores =
    results.map(
      (result) => result.score,
    );

  const max =
    Math.max(...scores);

  const min =
    Math.min(...scores);

  const range =
    max - min;

  for (const result of results) {
    let score = 1;

    if (range > 0) {
      score =
        (result.score - min) /
        range;
    }

    normalized.set(
      result.chunk.id,
      score,
    );
  }

  return normalized;
}

function findChunkForGraphEntity(
  chunks: CodeChunk[],
  filePath: string | undefined,
  name: string,
): CodeChunk | undefined {
  if (!filePath) {
    return undefined;
  }

  return chunks.find(
    (chunk) =>
      chunk.filePath === filePath &&
      chunk.name === name,
  );
}

export async function hybridSearch(
  query: string,
  graph: CodeGraph,
  chunks: CodeChunk[],
  vectorResults: VectorSearchResult[],
  options: HybridSearchOptions = {},
): Promise<HybridSearchResult[]> {
  const limit =
    options.limit ?? 10;

  const graphLimit =
    options.graphLimit ?? 15;

  const vectorWeight =
    options.vectorWeight ?? 0.6;

  const graphWeight =
    options.graphWeight ?? 0.4;

  const graphResults =
    graphSearch(
      graph,
      query,
      {
        limit: graphLimit,
        maxDepth:
          options.graphMaxDepth ?? 2,
      },
    );

  const normalizedVectorScores =
    normalizeVectorScores(
      vectorResults,
    );

  const resultMap =
    new Map<
      string,
      HybridSearchResult
    >();

  /*
   * Add vector results first.
   */
  for (const result of vectorResults) {
    const normalizedVectorScore =
      normalizedVectorScores.get(
        result.chunk.id,
      ) ?? 0;

    resultMap.set(
      result.chunk.id,
      {
        chunk: result.chunk,

        name:
          result.chunk.name ??
          result.chunk.filePath,

        filePath:
          result.chunk.filePath,

        vectorScore:
          normalizedVectorScore,

        graphScore: 0,

        hybridScore:
          normalizedVectorScore *
          vectorWeight,

        sources: ["vector"],
      },
    );
  }

  /*
   * Merge GraphRAG results.
   */
  for (const graphResult of graphResults) {
    const matchingChunk =
      findChunkForGraphEntity(
        chunks,
        graphResult.entity.filePath,
        graphResult.entity.name,
      );

    /*
     * Functions/classes usually map
     * directly to chunks.
     *
     * File/module graph nodes may not.
     */
    const key =
      matchingChunk?.id ??
      graphResult.entity.id;

    const existing =
      matchingChunk
        ? resultMap.get(
            matchingChunk.id,
          )
        : resultMap.get(key);

    if (existing) {
      existing.graphScore =
        Math.max(
          existing.graphScore,
          graphResult.score,
        );

      existing.hybridScore =
        existing.vectorScore *
          vectorWeight +
        existing.graphScore *
          graphWeight;

      if (
        !existing.sources.includes(
          "graph",
        )
      ) {
        existing.sources.push(
          "graph",
        );
      }

      existing.graphDepth =
        graphResult.depth;

      existing.graphMatchType =
        graphResult.matchType;

      continue;
    }

    resultMap.set(
      key,
      {
        chunk:
          matchingChunk,

        name:
          graphResult.entity.name,

        filePath:
          graphResult.entity.filePath,

        vectorScore: 0,

        graphScore:
          graphResult.score,

        hybridScore:
          graphResult.score *
          graphWeight,

        sources: ["graph"],

        graphDepth:
          graphResult.depth,

        graphMatchType:
          graphResult.matchType,
      },
    );
  }

  return Array.from(
    resultMap.values(),
  )
    .sort(
      (a, b) =>
        b.hybridScore -
        a.hybridScore,
    )
    .slice(0, limit);
}
