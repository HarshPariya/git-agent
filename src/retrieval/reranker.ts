import type { HybridSearchResult } from "./hybrid-search.js";

export interface RerankOptions {
  limit?: number;
  maxPerFile?: number;
}

export interface RerankedResult extends HybridSearchResult {
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

const normalize = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9_$]+/g, " ")
    .trim();

const splitIdentifier = (name: string): string[] =>
  name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9_$]+/)
    .filter((t) => t.length > 1);

const calculateExactNameBonus = (query: string, result: HybridSearchResult): number => {
  const nq = normalize(query);
  const nn = normalize(result.name);

  if (!nn) return 0;
  if (nq === nn) return 1;
  if (nq.includes(nn)) return 0.8;

  const expandedQuery = new Set(
    nq
      .split(/\s+/)
      .filter(Boolean)
      .flatMap((q) => [q, ...(QUERY_EXPANSIONS[q] ?? [])]),
  );

  const nameParts = splitIdentifier(result.name);
  if (nameParts.length === 0) return 0;

  const matchedParts = nameParts.filter((p) => expandedQuery.has(p)).length;

  return matchedParts === nameParts.length ? 0.85 : matchedParts > 0 ? 0.4 * (matchedParts / nameParts.length) : 0;
};

const calculateAgreementBonus = (r: HybridSearchResult): number =>
  r.sources.includes("vector") && r.sources.includes("graph") ? 1 : 0;

const DEPTH_BONUS_MAP: Record<number, number> = { 0: 1, 1: 0.7, 2: 0.4 };
const calculateDepthBonus = (r: HybridSearchResult): number =>
  r.graphDepth === undefined ? 0 : (DEPTH_BONUS_MAP[r.graphDepth] ?? 0.1);

const TYPE_BONUS_MAP: Record<string, number> = { function: 1, class: 1, file: 0.4 };
const calculateTypeBonus = (r: HybridSearchResult): number => TYPE_BONUS_MAP[r.chunk?.type ?? ""] ?? 0;

export const rerankResults = (
  query: string,
  results: HybridSearchResult[],
  options: RerankOptions = {},
): RerankedResult[] => {
  const limit = options.limit ?? results.length;
  const maxPerFile = options.maxPerFile ?? Number.POSITIVE_INFINITY;

  const ranked = results
    .map((result) => {
      const exactNameBonus = calculateExactNameBonus(query, result);
      const agreementBonus = calculateAgreementBonus(result);
      const depthBonus = calculateDepthBonus(result);
      const typeBonus = calculateTypeBonus(result);
      const hybridBase = result.hybridScore;

      return {
        ...result,
        rerankScore:
          hybridBase * 0.5 + exactNameBonus * 0.25 + agreementBonus * 0.1 + depthBonus * 0.1 + typeBonus * 0.05,
        rerankSignals: { hybridBase, exactNameBonus, agreementBonus, depthBonus, typeBonus },
      };
    })
    .sort((a, b) => b.rerankScore - a.rerankScore);

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
};
