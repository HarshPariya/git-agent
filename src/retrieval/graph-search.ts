import type { CodeGraph, TraversalResult } from "../graph/graph-builder.js";
import { traverseGraph } from "../graph/graph-builder.js";
import type { GraphEntity, EntityType } from "../graph/entity-extractor.js";
import type { RelationshipType } from "../graph/relationship-extractor.js";
import { validateGraphDepth } from "../guardrails/retrieval-limits.js";
import { LIMITS } from "../config/limits.js";

export interface GraphSearchOptions { limit?: number | undefined; maxDepth?: number | undefined; entityTypes?: EntityType[] | undefined; relationshipTypes?: RelationshipType[] | undefined; }
export interface GraphSearchResult { entity: GraphEntity; score: number; matchType: "exact" | "name" | "partial" | "graph"; depth: number; matchedTerm?: string | undefined; }

const QUERY_EXPANSIONS: Record<string, string[]> = {
  combined: ["hybrid", "merge", "fusion"], combine: ["hybrid", "merge", "fusion"], combining: ["hybrid", "merge", "fusion"],
  built: ["build", "builder", "construct"], building: ["build", "builder", "construct"],
  incoming: ["incoming", "getincoming"], outgoing: ["outgoing", "getoutgoing"],
  reranked: ["rerank", "reranking"], reranking: ["rerank"],
  extracted: ["extract", "extractor"], extraction: ["extract", "extractor"],
};
const normalizeText = (v: string): string => v.toLowerCase().replace(/[^a-z0-9_$]+/g, " ").trim();
const tokenizeQuery = (query: string): string[] => {
  const stopWords = new Set(["the", "a", "an", "is", "are", "where", "what", "which", "how", "does", "do", "in", "of", "to", "for", "and", "or", "used", "use"]);
  const baseTokens = normalizeText(query).split(/\s+/).filter((t) => t.length > 1 && !stopWords.has(t));
  const expanded = new Set(baseTokens);
  for (const token of baseTokens) for (const e of QUERY_EXPANSIONS[token] ?? []) expanded.add(e);
  return Array.from(expanded);
};
const getEntitySearchText = (e: GraphEntity): string => normalizeText([e.name, e.filePath ?? "", e.type].join(" "));

function scoreEntity(entity: GraphEntity, query: string, terms: string[]): { score: number; matchType?: GraphSearchResult["matchType"] | undefined; matchedTerm?: string | undefined } {
  const normalizedQuery = normalizeText(query), normalizedName = normalizeText(entity.name), searchableText = getEntitySearchText(entity);
  if (normalizedName === normalizedQuery) return { score: 1, matchType: "exact", matchedTerm: query };
  if (normalizedName.length > 1 && normalizedQuery.includes(normalizedName)) return { score: 0.9, matchType: "name", matchedTerm: entity.name };
  let matchedTerms = 0, strongestTerm: string | undefined;
  for (const term of terms) { if (searchableText.includes(term)) { matchedTerms++; if (!strongestTerm || term.length > strongestTerm.length) strongestTerm = term; } }
  if (matchedTerms === 0) return { score: 0 };
  return { score: 0.45 + (matchedTerms / Math.max(terms.length, 1)) * 0.35, matchType: "partial", matchedTerm: strongestTerm };
}

function findSeedEntities(graph: CodeGraph, query: string, options: GraphSearchOptions): GraphSearchResult[] {
  const terms = tokenizeQuery(query), results: GraphSearchResult[] = [];
  for (const entity of graph.nodes.values()) {
    if (options.entityTypes?.length && !options.entityTypes.includes(entity.type)) continue;
    const scored = scoreEntity(entity, query, terms);
    if (scored.score <= 0 || !scored.matchType) continue;
    results.push({ entity, score: scored.score, matchType: scored.matchType, depth: 0, matchedTerm: scored.matchedTerm });
  }
  return results.sort((a, b) => b.score - a.score);
}

const scoreGraphExpansion = (t: TraversalResult, seedScore: number): number => seedScore * Math.max(0.25, 1 - t.depth * 0.25);

export function graphSearch(graph: CodeGraph, query: string, options: GraphSearchOptions = {}): GraphSearchResult[] {
  const limit = options.limit ?? 10, maxDepth = validateGraphDepth(options.maxDepth);
  const seeds = findSeedEntities(graph, query, options);
  if (seeds.length === 0) return [];
  const selectedSeeds = seeds.slice(0, Math.min(seeds.length, 5)), resultMap = new Map<string, GraphSearchResult>();
  let totalNodesVisited = 0;
  for (const seed of selectedSeeds) {
    resultMap.set(seed.entity.id, seed);
    for (const traversed of traverseGraph(graph, seed.entity.id, { maxDepth, relationshipTypes: options.relationshipTypes })) {
      totalNodesVisited++;
      if (totalNodesVisited > LIMITS.maxGraphNodesVisited) { console.warn(`⚠️ Bounded graph traversal at node limit (${LIMITS.maxGraphNodesVisited} nodes)`); break; }
      if (traversed.depth === 0) continue;
      if (options.entityTypes?.length && !options.entityTypes.includes(traversed.entity.type)) continue;
      const graphScore = scoreGraphExpansion(traversed, seed.score);
      const existing = resultMap.get(traversed.entity.id);
      if (existing && existing.score >= graphScore) continue;
      resultMap.set(traversed.entity.id, { entity: traversed.entity, score: graphScore, matchType: "graph", depth: traversed.depth, matchedTerm: seed.entity.name });
    }
  }
  for (const seed of seeds) { const existing = resultMap.get(seed.entity.id); if (!existing || seed.score > existing.score) resultMap.set(seed.entity.id, seed); }
  return Array.from(resultMap.values()).sort((a, b) => b.score - a.score).slice(0, limit);
}
