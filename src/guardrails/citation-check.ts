import type { RetrievalResult } from "../retrieval/types.js";

export interface CitationCheckRequest {
  readonly answer: string;
  readonly sources: readonly RetrievalResult[];
}

export interface CitationCheckResult {
  readonly valid: boolean;
  readonly citations: readonly string[];
  readonly reason: string;
}

const CITATION_PATTERN = /\[([^\]]+)\]/g;

const extractCitations = (answer: string): readonly string[] =>
  [...answer.matchAll(CITATION_PATTERN)]
    .map((match) => match[1]?.trim())
    .filter((citation): citation is string => Boolean(citation));

const normalize = (value: string): string => value.trim().toLowerCase();

const matchesSource = (citation: string, source: RetrievalResult): boolean => {
  const normalizedCitation = normalize(citation);
  const normalizedSource = normalize(source.source);

  switch (true) {
    case normalizedCitation === normalizedSource:
      return true;

    case normalizedCitation === `${normalizedSource} page ${source.page}`:
      return true;

    default:
      return false;
  }
};

export const verifyCitations = ({
  answer,
  sources,
}: CitationCheckRequest): CitationCheckResult => {
  const citations = extractCitations(answer);

  switch (citations.length) {
    case 0:
      return {
        valid: false,
        citations,
        reason: "No citations were found in the answer.",
      };

    default:
      break;
  }

  const invalidCitation = citations.find(
    (citation) => !sources.some((source) => matchesSource(citation, source)),
  );

  switch (invalidCitation) {
    case undefined:
      return {
        valid: true,
        citations,
        reason: "All citations match retrieved sources.",
      };

    default:
      return {
        valid: false,
        citations,
        reason: `Citation does not match retrieved sources: ${invalidCitation}`,
      };
  }
};
