import type { CodeGraph } from "../graph/graph-builder.js";
import type { CodeChunk } from "../ingestion/chunker.js";
import type { VectorSearchResult } from "./vector-search.js";
import { graphSearch } from "./graph-search.js";

export interface HybridSearchOptions {
  limit?: number;
  graphLimit?: number;
  graphMaxDepth?: number;
  vectorWeight?: number;
  graphWeight?: number;
}

export interface HybridSearchResult {
  chunk?: CodeChunk;
  name: string;
  filePath?: string;
  vectorScore: number;
  graphScore: number;
  hybridScore: number;
  sources: Array<"vector" | "graph">;
  graphDepth?: number;
  graphMatchType?: string;
}

const GRAPH_PATTERN = /\b(?:relationship|related|trace|flow|caller|calls?|uses?|depends?|imported?|where is .* defined)\b/i;
const EXPLAIN_PATTERN = /\b(?:explain|how does|what does|architecture|pipeline)\b/i;

export const inferHybridWeights = (query: string): { vectorWeight: number; graphWeight: number } => {
  if (GRAPH_PATTERN.test(query)) return { vectorWeight: 0.35, graphWeight: 0.65 };
  if (EXPLAIN_PATTERN.test(query)) return { vectorWeight: 0.65, graphWeight: 0.35 };
  return { vectorWeight: 0.6, graphWeight: 0.4 };
};

const reciprocalRankScore = (rank: number): number => (1 / (60 + rank)) / (1 / 61);

const normalizeVectorScores = (results: VectorSearchResult[]): Map<string, number> => {
  if (results.length === 0) return new Map();

  const scores = results.map((r) => r.score);
  const max = Math.max(...scores);
  const min = Math.min(...scores);
  const range = max - min;

  return new Map(
    results.map((r) => [r.chunk.id, range > 0 ? (r.score - min) / range : 1])
  );
};

const findChunkForGraphEntity = (
  chunks: CodeChunk[],
  filePath: string | undefined,
  name: string
): CodeChunk | undefined =>
  filePath ? chunks.find((c) => c.filePath === filePath && c.name === name) : undefined;

export const hybridSearch = async (
  query: string,
  graph: CodeGraph,
  chunks: CodeChunk[],
  vectorResults: VectorSearchResult[],
  options: HybridSearchOptions = {}
): Promise<HybridSearchResult[]> => {
  const limit = options.limit ?? 10;
  const graphLimit = options.graphLimit ?? 15;
  const inferredWeights = inferHybridWeights(query);
  const vectorWeight = options.vectorWeight ?? inferredWeights.vectorWeight;
  const graphWeight = options.graphWeight ?? inferredWeights.graphWeight;

  const graphResults = graphSearch(graph, query, {
    limit: graphLimit,
    maxDepth: options.graphMaxDepth ?? 2,
  });

  const normalizedVectorScores = normalizeVectorScores(vectorResults);
  const resultMap = new Map<string, HybridSearchResult>();

  for (const [vectorIndex, result] of vectorResults.entries()) {
    const normalizedVectorScore = normalizedVectorScores.get(result.chunk.id) ?? 0;

    resultMap.set(result.chunk.id, {
      chunk: result.chunk,
      name: result.chunk.name ?? result.chunk.filePath,
      filePath: result.chunk.filePath,
      vectorScore: normalizedVectorScore,
      graphScore: 0,
      hybridScore: reciprocalRankScore(vectorIndex + 1) * vectorWeight,
      sources: ["vector"],
    });
  }

  for (const [graphIndex, graphResult] of graphResults.entries()) {
    const matchingChunk = findChunkForGraphEntity(chunks, graphResult.entity.filePath, graphResult.entity.name);
    const key = matchingChunk?.id ?? graphResult.entity.id;
    const existing = matchingChunk ? resultMap.get(matchingChunk.id) : resultMap.get(key);

    if (existing) {
      existing.graphScore = Math.max(existing.graphScore, graphResult.score);
      const vectorRank = vectorResults.findIndex((item) => item.chunk.id === matchingChunk?.id);

      existing.hybridScore =
        (vectorRank >= 0 ? reciprocalRankScore(vectorRank + 1) * vectorWeight : 0) +
        reciprocalRankScore(graphIndex + 1) * graphWeight;

      if (!existing.sources.includes("graph")) existing.sources.push("graph");
      existing.graphDepth = graphResult.depth;
      existing.graphMatchType = graphResult.matchType;
      continue;
    }

    const newResult: HybridSearchResult = {
      name: graphResult.entity.name,
      vectorScore: 0,
      graphScore: graphResult.score,
      hybridScore: reciprocalRankScore(graphIndex + 1) * graphWeight,
      sources: ["graph"],
      graphDepth: graphResult.depth,
      graphMatchType: graphResult.matchType,
    };

    if (graphResult.entity.filePath) newResult.filePath = graphResult.entity.filePath;
    if (matchingChunk) newResult.chunk = matchingChunk;
    resultMap.set(key, newResult);
  }

  return Array.from(resultMap.values())
    .sort((a, b) => b.hybridScore - a.hybridScore)
    .slice(0, limit);
};
