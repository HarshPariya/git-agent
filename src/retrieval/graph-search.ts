import type { CodeGraph, TraversalResult } from "../graph/graph-builder.js";
import { traverseGraph } from "../graph/graph-builder.js";
import type { GraphEntity, EntityType } from "../graph/entity-extractor.js";
import type { RelationshipType } from "../graph/relationship-extractor.js";
import { validateGraphDepth } from "../guardrails/retrieval-limits.js";
import { LIMITS } from "../config/limits.js";

export interface GraphSearchOptions {
  limit?: number;
  maxDepth?: number;
  entityTypes?: EntityType[];
  relationshipTypes?: RelationshipType[];
}

export interface GraphSearchResult {
  entity: GraphEntity;
  score: number;
  matchType: "exact" | "name" | "partial" | "graph";
  depth: number;
  matchedTerm?: string;
}

const QUERY_EXPANSIONS: Record<string, string[]> = {
  combined: ["hybrid", "merge", "fusion"],
  combine: ["hybrid", "merge", "fusion"],
  combining: ["hybrid", "merge", "fusion"],
  built: ["build", "builder", "construct"],
  building: ["build", "builder", "construct"],
  incoming: ["incoming", "getincoming"],
  outgoing: ["outgoing", "getoutgoing"],
  reranked: ["rerank", "reranking"],
  reranking: ["rerank"],
  extracted: ["extract", "extractor"],
  extraction: ["extract", "extractor"],
};

const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "is",
  "are",
  "where",
  "what",
  "which",
  "how",
  "does",
  "do",
  "in",
  "of",
  "to",
  "for",
  "and",
  "or",
  "used",
  "use",
]);

const normalizeText = (v: string): string =>
  v
    .toLowerCase()
    .replace(/[^a-z0-9_$]+/g, " ")
    .trim();

const tokenizeQuery = (query: string): string[] => {
  const baseTokens = normalizeText(query)
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));

  return [...new Set(baseTokens.flatMap((token) => [token, ...(QUERY_EXPANSIONS[token] ?? [])]))];
};

const getEntitySearchText = (e: GraphEntity): string => normalizeText([e.name, e.filePath ?? "", e.type].join(" "));

const scoreEntity = (
  entity: GraphEntity,
  query: string,
  terms: string[],
): { score: number; matchType?: GraphSearchResult["matchType"]; matchedTerm?: string } => {
  const normalizedQuery = normalizeText(query);
  const normalizedName = normalizeText(entity.name);
  const searchableText = getEntitySearchText(entity);

  if (normalizedName === normalizedQuery) return { score: 1, matchType: "exact", matchedTerm: query };
  if (normalizedName.length > 1 && normalizedQuery.includes(normalizedName))
    return { score: 0.9, matchType: "name", matchedTerm: entity.name };

  const matchedTerms = terms.filter((term) => searchableText.includes(term));
  if (matchedTerms.length === 0) return { score: 0 };

  const strongestTerm = matchedTerms.reduce((a, b) => (a.length > b.length ? a : b));

  return {
    score: 0.45 + (matchedTerms.length / Math.max(terms.length, 1)) * 0.35,
    matchType: "partial",
    matchedTerm: strongestTerm,
  };
};

const findSeedEntities = (graph: CodeGraph, query: string, options: GraphSearchOptions): GraphSearchResult[] => {
  const terms = tokenizeQuery(query);

  const results: GraphSearchResult[] = [];

  for (const entity of graph.nodes.values()) {
    if (options.entityTypes?.length && !options.entityTypes.includes(entity.type)) continue;

    const scored = scoreEntity(entity, query, terms);
    if (scored.score > 0 && scored.matchType) {
      const result: GraphSearchResult = {
        entity,
        score: scored.score,
        matchType: scored.matchType,
        depth: 0,
      };
      if (scored.matchedTerm) result.matchedTerm = scored.matchedTerm;
      results.push(result);
    }
  }

  return results.sort((a, b) => b.score - a.score);
};

const scoreGraphExpansion = (t: TraversalResult, seedScore: number): number =>
  seedScore * Math.max(0.25, 1 - t.depth * 0.25);

export const graphSearch = (graph: CodeGraph, query: string, options: GraphSearchOptions = {}): GraphSearchResult[] => {
  const limit = options.limit ?? 10;
  const maxDepth = validateGraphDepth(options.maxDepth);
  const seeds = findSeedEntities(graph, query, options);

  if (seeds.length === 0) return [];

  const selectedSeeds = seeds.slice(0, Math.min(seeds.length, 5));
  const resultMap = new Map<string, GraphSearchResult>();
  let totalNodesVisited = 0;

  for (const seed of selectedSeeds) {
    resultMap.set(seed.entity.id, seed);

    for (const traversed of traverseGraph(graph, seed.entity.id, {
      maxDepth,
      relationshipTypes: options.relationshipTypes,
    })) {
      totalNodesVisited++;

      if (totalNodesVisited > LIMITS.maxGraphNodesVisited) {
        console.warn(`Bounded graph traversal at node limit (${LIMITS.maxGraphNodesVisited} nodes)`);
        break;
      }

      if (traversed.depth === 0) continue;
      if (options.entityTypes?.length && !options.entityTypes.includes(traversed.entity.type)) continue;

      const graphScore = scoreGraphExpansion(traversed, seed.score);
      const existing = resultMap.get(traversed.entity.id);

      if (existing && existing.score >= graphScore) continue;

      resultMap.set(traversed.entity.id, {
        entity: traversed.entity,
        score: graphScore,
        matchType: "graph",
        depth: traversed.depth,
        matchedTerm: seed.entity.name,
      });
    }
  }

  for (const seed of seeds) {
    const existing = resultMap.get(seed.entity.id);
    if (!existing || seed.score > existing.score) {
      resultMap.set(seed.entity.id, seed);
    }
  }

  return Array.from(resultMap.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
};
