import type { RetrievalResult } from "./types.js";

export interface UnifiedRetrievalResult extends RetrievalResult {
  readonly sourceType?: "code";
  readonly pageNumber?: number;
}

export interface CompressedEvidence {
  readonly id: string;
  readonly sourceType: "code";
  readonly source: string;
  readonly location?: string;
  readonly page?: number;
  readonly content: string;
  readonly score: number;
}

export interface CompressionResult {
  readonly evidence: readonly CompressedEvidence[];
  readonly candidatesRetrieved: number;
  readonly candidateCountAfterDeduplication: number;
  readonly sentToLLM: number;
}

export const compressContext = (
  candidates: readonly UnifiedRetrievalResult[],
  maxEvidenceCount = 4,
  minScoreThreshold = 0.1
): CompressionResult => {
  const validCandidates = candidates.filter((c) => c.score >= minScoreThreshold);

  const seenContentHashes = new Set<string>();
  const deduplicated = validCandidates.filter((item) => {
    const norm = item.content.trim().toLowerCase().slice(0, 150);
    if (seenContentHashes.has(norm)) return false;
    seenContentHashes.add(norm);
    return true;
  });

  const selected = deduplicated.slice(0, maxEvidenceCount);

  const evidence: CompressedEvidence[] = selected.map((item, index) => {
    const loc = item.metadata?.startLine
      ? `lines ${item.metadata.startLine}-${item.metadata.endLine}`
      : undefined;
    const pg = item.pageNumber ?? (item.metadata?.pageNumber ? Number(item.metadata.pageNumber) : undefined);

    return {
      id: `S${index + 1}`,
      sourceType: "code" as const,
      source: item.source,
      ...(loc !== undefined && { location: loc }),
      ...(pg !== undefined && { page: pg }),
      content: item.content,
      score: Number(item.score.toFixed(3)),
    };
  });

  return {
    evidence,
    candidatesRetrieved: candidates.length,
    candidateCountAfterDeduplication: deduplicated.length,
    sentToLLM: evidence.length,
  };
};
