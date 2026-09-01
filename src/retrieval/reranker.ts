import type {
  HybridSearchResult,
} from "./hybrid-search.js";

export interface RerankOptions {
  limit?: number;
  maxPerFile?: number;
}

export interface RerankedResult
  extends HybridSearchResult {
  rerankScore: number;

  rerankSignals: {
    hybridBase: number;
    exactNameBonus: number;
    agreementBonus: number;
    depthBonus: number;
    typeBonus: number;
  };
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

function normalizeQuery(
  query: string,
): string {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9_$]+/g, " ")
    .trim();
}

function normalizeName(
  name: string,
): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_$]+/g, " ")
    .trim();
}

function splitIdentifier(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9_$]+/)
    .filter((t) => t.length > 1);
}

function calculateExactNameBonus(
  query: string,
  result: HybridSearchResult,
): number {
  const normalizedQuery =
    normalizeQuery(query);

  const normalizedName =
    normalizeName(result.name);

  if (!normalizedName) {
    return 0;
  }

  if (
    normalizedQuery === normalizedName
  ) {
    return 1;
  }

  if (
    normalizedQuery.includes(
      normalizedName,
    )
  ) {
    return 0.8;
  }

  const queryTokens = normalizedQuery
    .split(/\s+/)
    .filter(Boolean);

  const expandedQuery = new Set<string>(queryTokens);
  for (const q of queryTokens) {
    for (const exp of QUERY_EXPANSIONS[q] ?? []) {
      expandedQuery.add(exp);
    }
  }

  const nameParts = splitIdentifier(result.name);
  if (nameParts.length > 0) {
    let matchedParts = 0;
    for (const part of nameParts) {
      if (expandedQuery.has(part)) {
        matchedParts++;
      }
    }

    if (matchedParts === nameParts.length) {
      return 0.85;
    } else if (matchedParts > 0) {
      return 0.4 * (matchedParts / nameParts.length);
    }
  }

  return 0;
}

function calculateAgreementBonus(
  result: HybridSearchResult,
): number {
  const hasVector =
    result.sources.includes("vector");

  const hasGraph =
    result.sources.includes("graph");

  return hasVector && hasGraph
    ? 1
    : 0;
}

function calculateDepthBonus(
  result: HybridSearchResult,
): number {
  if (
    result.graphDepth === undefined
  ) {
    return 0;
  }

  if (result.graphDepth === 0) {
    return 1;
  }

  if (result.graphDepth === 1) {
    return 0.7;
  }

  if (result.graphDepth === 2) {
    return 0.4;
  }

  return 0.1;
}

function calculateTypeBonus(
  result: HybridSearchResult,
): number {
  const type =
    result.chunk?.type;

  if (
    type === "function" ||
    type === "class"
  ) {
    return 1;
  }

  if (type === "file") {
    return 0.4;
  }

  return 0;
}

export function rerankResults(
  query: string,
  results: HybridSearchResult[],
  options: RerankOptions = {},
): RerankedResult[] {
  const limit =
    options.limit ??
    results.length;

  const ranked = results
    .map((result) => {
      const exactNameBonus =
        calculateExactNameBonus(
          query,
          result,
        );

      const agreementBonus =
        calculateAgreementBonus(
          result,
        );

      const depthBonus =
        calculateDepthBonus(
          result,
        );

      const typeBonus =
        calculateTypeBonus(
          result,
        );

      const hybridBase =
        result.hybridScore;

      const rerankScore =
        hybridBase * 0.50 +
        exactNameBonus * 0.25 +
        agreementBonus * 0.10 +
        depthBonus * 0.10 +
        typeBonus * 0.05;

      return {
        ...result,

        rerankScore,

        rerankSignals: {
          hybridBase,
          exactNameBonus,
          agreementBonus,
          depthBonus,
          typeBonus,
        },
      };
    })
    .sort(
      (a, b) =>
        b.rerankScore -
        a.rerankScore,
    )
  const maxPerFile = options.maxPerFile ?? Number.POSITIVE_INFINITY;
  const fileCounts = new Map<string, number>();
  const diverse: RerankedResult[] = [];
  for (const result of ranked) {
    const key = result.filePath ?? result.name;
    const count = fileCounts.get(key) ?? 0;
    if (count >= maxPerFile) continue;
    fileCounts.set(key, count + 1);
    diverse.push(result);
    if (diverse.length === limit) break;
  }
  return diverse;
}
