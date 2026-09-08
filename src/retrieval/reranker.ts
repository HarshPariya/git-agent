import type { HybridSearchResult } from "./hybrid-search.js";

export interface RerankOptions { limit?: number; maxPerFile?: number; }
export interface RerankedResult extends HybridSearchResult { rerankScore: number; rerankSignals: { hybridBase: number; exactNameBonus: number; agreementBonus: number; depthBonus: number; typeBonus: number; }; }

const QUERY_EXPANSIONS: Record<string, string[]> = {
  combined: ["hybrid", "merge", "fusion"], combine: ["hybrid", "merge", "fusion"], combining: ["hybrid", "merge", "fusion"],
  built: ["build", "builder", "construct"], building: ["build", "builder", "construct"],
  incoming: ["incoming", "getincoming"], outgoing: ["outgoing", "getoutgoing"],
  reranked: ["rerank", "reranking"], reranking: ["rerank"],
  extracted: ["extract", "extractor"], extraction: ["extract", "extractor"],
};
const normalize = (s: string): string => s.toLowerCase().replace(/[^a-z0-9_$]+/g, " ").trim();
const splitIdentifier = (name: string): string[] => name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9_$]+/).filter((t) => t.length > 1);

function calculateExactNameBonus(query: string, result: HybridSearchResult): number {
  const nq = normalize(query), nn = normalize(result.name);
  if (!nn) return 0;
  if (nq === nn) return 1;
  if (nq.includes(nn)) return 0.8;
  const queryTokens = nq.split(/\s+/).filter(Boolean);
  const expandedQuery = new Set<string>(queryTokens);
  for (const q of queryTokens) for (const e of QUERY_EXPANSIONS[q] ?? []) expandedQuery.add(e);
  const nameParts = splitIdentifier(result.name);
  if (nameParts.length > 0) {
    const matchedParts = nameParts.filter((p) => expandedQuery.has(p)).length;
    if (matchedParts === nameParts.length) return 0.85;
    if (matchedParts > 0) return 0.4 * (matchedParts / nameParts.length);
  }
  return 0;
}
const calculateAgreementBonus = (r: HybridSearchResult): number => r.sources.includes("vector") && r.sources.includes("graph") ? 1 : 0;
const calculateDepthBonus = (r: HybridSearchResult): number => r.graphDepth === undefined ? 0 : r.graphDepth === 0 ? 1 : r.graphDepth === 1 ? 0.7 : r.graphDepth === 2 ? 0.4 : 0.1;
const calculateTypeBonus = (r: HybridSearchResult): number => r.chunk?.type === "function" || r.chunk?.type === "class" ? 1 : r.chunk?.type === "file" ? 0.4 : 0;

export function rerankResults(query: string, results: HybridSearchResult[], options: RerankOptions = {}): RerankedResult[] {
  const limit = options.limit ?? results.length;
  const ranked = results.map((result) => {
    const exactNameBonus = calculateExactNameBonus(query, result), agreementBonus = calculateAgreementBonus(result), depthBonus = calculateDepthBonus(result), typeBonus = calculateTypeBonus(result), hybridBase = result.hybridScore;
    return { ...result, rerankScore: hybridBase * 0.50 + exactNameBonus * 0.25 + agreementBonus * 0.10 + depthBonus * 0.10 + typeBonus * 0.05, rerankSignals: { hybridBase, exactNameBonus, agreementBonus, depthBonus, typeBonus } };
  }).sort((a, b) => b.rerankScore - a.rerankScore);
  const maxPerFile = options.maxPerFile ?? Number.POSITIVE_INFINITY, fileCounts = new Map<string, number>(), diverse: RerankedResult[] = [];
  for (const result of ranked) {
    const key = result.filePath ?? result.name, count = fileCounts.get(key) ?? 0;
    if (count >= maxPerFile) continue;
    fileCounts.set(key, count + 1);
    diverse.push(result);
    if (diverse.length === limit) break;
  }
  return diverse;
}
