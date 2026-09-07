import type { RetrievalResult } from "./types.js";

export interface UnifiedRetrievalResult extends RetrievalResult {
  readonly sourceType?: "code" | undefined;
  readonly pageNumber?: number | undefined;
}

export interface CompressedEvidence {
  readonly id: string;
  readonly sourceType: "code";
  readonly source: string;
  readonly location?: string | undefined;
  readonly page?: number | undefined;
  readonly content: string;
  readonly score: number;
}

export interface CompressionResult {
  readonly evidence: readonly CompressedEvidence[];
  readonly candidatesRetrieved: number;
  readonly candidateCountAfterDeduplication: number;
  readonly sentToLLM: number;
}

export function compressContext(
  candidates: readonly UnifiedRetrievalResult[],
  maxEvidenceCount = 4,
  minScoreThreshold = 0.1,
): CompressionResult {
  const candidatesRetrieved = candidates.length;

  // 1. Filter low confidence candidates
  const validCandidates = candidates.filter((c) => c.score >= minScoreThreshold);

  // 2. Candidate Deduplication & Overlap Removal
  const seenContentHashes = new Set<string>();
  const deduplicated: UnifiedRetrievalResult[] = [];

  for (const item of validCandidates) {
    const norm = item.content.trim().toLowerCase().slice(0, 150);
    if (!seenContentHashes.has(norm)) {
      seenContentHashes.add(norm);
      deduplicated.push(item);
    }
  }

  const candidateCountAfterDeduplication = deduplicated.length;

  // 3. Select top N evidence candidates
  const selected = deduplicated.slice(0, maxEvidenceCount);

  // 4. Map to structured evidence items with stable source IDs ([S1], [S2], etc.)
  const evidence: CompressedEvidence[] = selected.map((item, index) => {
    const loc = item.metadata?.startLine ? `lines ${item.metadata.startLine}-${item.metadata.endLine}` : undefined;
    const pg = item.pageNumber ?? (item.metadata?.pageNumber ? Number(item.metadata.pageNumber) : undefined);
    return {
      id: `S${index + 1}`,
      sourceType: "code",
      source: item.source,
      ...(loc !== undefined && { location: loc }),
      ...(pg !== undefined && { page: pg }),
      content: item.content,
      score: Number(item.score.toFixed(3)),
    };
  });

  return {
    evidence,
    candidatesRetrieved,
    candidateCountAfterDeduplication,
    sentToLLM: evidence.length,
  };
}
