import type {
  CodeGraph,
  TraversalResult,
} from "../graph/graph-builder.js";

import {
  traverseGraph,
} from "../graph/graph-builder.js";

import type {
  GraphEntity,
  EntityType,
} from "../graph/entity-extractor.js";

import type {
  RelationshipType,
} from "../graph/relationship-extractor.js";
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

  matchType:
    | "exact"
    | "name"
    | "partial"
    | "graph";

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

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_$]+/g, " ")
    .trim();
}

function tokenizeQuery(
  query: string,
): string[] {
  const stopWords = new Set([
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

  const baseTokens = normalizeText(query)
    .split(/\s+/)
    .filter(Boolean)
    .filter(
      (token) =>
        token.length > 1 &&
        !stopWords.has(token),
    );

  const expanded = new Set(baseTokens);

  for (const token of baseTokens) {
    for (
      const expansion
      of QUERY_EXPANSIONS[token] ?? []
    ) {
      expanded.add(expansion);
    }
  }

  return Array.from(expanded);
}

function getEntitySearchText(
  entity: GraphEntity,
): string {
  return normalizeText(
    [
      entity.name,
      entity.filePath ?? "",
      entity.type,
    ].join(" "),
  );
}

function scoreEntity(
  entity: GraphEntity,
  query: string,
  terms: string[],
): {
  score: number;
  matchType?: GraphSearchResult["matchType"];
  matchedTerm?: string;
} {
  const normalizedQuery =
    normalizeText(query);

  const normalizedName =
    normalizeText(entity.name);

  const searchableText =
    getEntitySearchText(entity);

  /*
   * Exact entity name match.
   *
   * Example:
   * query = "normalizeId"
   * entity = normalizeId
   */
  if (
    normalizedName === normalizedQuery
  ) {
    return {
      score: 1,
      matchType: "exact",
      matchedTerm: query,
    };
  }

  /*
   * Query contains entire entity name.
   *
   * Example:
   * "where is normalizeId used"
   */
  if (
    normalizedName.length > 1 &&
    normalizedQuery.includes(
      normalizedName,
    )
  ) {
    return {
      score: 0.9,
      matchType: "name",
      matchedTerm: entity.name,
    };
  }

  let matchedTerms = 0;
  let strongestTerm: string | undefined;

  for (const term of terms) {
    if (searchableText.includes(term)) {
      matchedTerms++;

      if (
        !strongestTerm ||
        term.length > strongestTerm.length
      ) {
        strongestTerm = term;
      }
    }
  }

  if (matchedTerms === 0) {
    return {
      score: 0,
    };
  }

  const coverage =
    matchedTerms /
    Math.max(terms.length, 1);

  /*
   * Keep lexical seed results below
   * exact/name matches.
   */
  const score =
    0.45 +
    coverage * 0.35;

  return {
    score,
    matchType: "partial",
    matchedTerm: strongestTerm,
  };
}

function findSeedEntities(
  graph: CodeGraph,
  query: string,
  options: GraphSearchOptions,
): GraphSearchResult[] {
  const terms = tokenizeQuery(query);

  const results: GraphSearchResult[] = [];

  for (const entity of graph.nodes.values()) {
    if (
      options.entityTypes &&
      options.entityTypes.length > 0 &&
      !options.entityTypes.includes(
        entity.type,
      )
    ) {
      continue;
    }

    const scored =
      scoreEntity(
        entity,
        query,
        terms,
      );

    if (
      scored.score <= 0 ||
      !scored.matchType
    ) {
      continue;
    }

    results.push({
      entity,

      score: scored.score,

      matchType: scored.matchType,

      depth: 0,

      matchedTerm:
        scored.matchedTerm,
    });
  }

  return results.sort(
    (a, b) => b.score - a.score,
  );
}

function scoreGraphExpansion(
  traversal: TraversalResult,
  seedScore: number,
): number {
  /*
   * Graph-connected results lose some
   * relevance at every hop.
   *
   * depth 1: ~75% of seed score
   * depth 2: ~50%
   * depth 3: ~25%
   */
  const decay =
    Math.max(
      0.25,
      1 - traversal.depth * 0.25,
    );

  return seedScore * decay;
}

export function graphSearch(
  graph: CodeGraph,
  query: string,
  options: GraphSearchOptions = {},
): GraphSearchResult[] {
  const limit = options.limit ?? 10;
  const maxDepth = validateGraphDepth(options.maxDepth);

  const seeds = findSeedEntities(graph, query, options);

  if (seeds.length === 0) {
    return [];
  }

  const seedLimit = Math.min(seeds.length, 5);
  const selectedSeeds = seeds.slice(0, seedLimit);
  const resultMap = new Map<string, GraphSearchResult>();

  let totalNodesVisited = 0;

  for (const seed of selectedSeeds) {
    resultMap.set(seed.entity.id, seed);

    const traversal = traverseGraph(graph, seed.entity.id, {
      maxDepth,
      relationshipTypes: options.relationshipTypes,
    });

    for (const traversed of traversal) {
      totalNodesVisited++;
      if (totalNodesVisited > LIMITS.maxGraphNodesVisited) {
        console.warn(`⚠️ Bounded graph traversal at node limit (${LIMITS.maxGraphNodesVisited} nodes)`);
        break;
      }
      if (
        traversed.depth === 0
      ) {
        continue;
      }

      if (
        options.entityTypes &&
        options.entityTypes.length > 0 &&
        !options.entityTypes.includes(
          traversed.entity.type,
        )
      ) {
        continue;
      }

      const graphScore =
        scoreGraphExpansion(
          traversed,
          seed.score,
        );

      const existing =
        resultMap.get(
          traversed.entity.id,
        );

      /*
       * Preserve whichever path gave
       * the strongest score.
       */
      if (
        existing &&
        existing.score >= graphScore
      ) {
        continue;
      }

      resultMap.set(
        traversed.entity.id,
        {
          entity:
            traversed.entity,

          score:
            graphScore,

          matchType:
            "graph",

          depth:
            traversed.depth,

          matchedTerm:
            seed.entity.name,
        },
      );
    }
  }

  /*
   * Include strong lexical matches that
   * weren't among the expansion seeds.
   */
  for (const seed of seeds) {
    const existing =
      resultMap.get(
        seed.entity.id,
      );

    if (
      !existing ||
      seed.score > existing.score
    ) {
      resultMap.set(
        seed.entity.id,
        seed,
      );
    }
  }

  return Array.from(
    resultMap.values(),
  )
    .sort(
      (a, b) =>
        b.score - a.score,
    )
    .slice(0, limit);
}
