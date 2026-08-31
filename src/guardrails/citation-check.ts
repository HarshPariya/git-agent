import type { RetrievalResult } from "../retrieval/types.js";
import type {
  CitationCheckRequest,
  CitationCheckResult,
} from "../types/guardrails.js";

export type { CitationCheckRequest, CitationCheckResult };

const CITATION_PATTERN = /\[([^\]]+)\]/g;

export const extractCitations = (answer: string): readonly string[] =>
  [...answer.matchAll(CITATION_PATTERN)]
    .map((match) => match[1]?.trim())
    .filter((citation): citation is string => Boolean(citation));

const normalize = (value: string): string => value.trim().toLowerCase();

const matchesSource = (citation: string, source: RetrievalResult): boolean => {
  const normCitation = normalize(citation);
  const normSource = normalize(source.source);
  return (
    normCitation === normSource ||
    normCitation === `${normSource} page ${source.page}`
  );
};

export const verifyCitations = ({
  answer,
  sources,
}: CitationCheckRequest): CitationCheckResult => {
  const citations = extractCitations(answer);
  const invalidCitation = citations.find(
    (citation) => !sources.some((source) => matchesSource(citation, source)),
  );

  return citations.length === 0
    ? {
      valid: false,
      citations,
      reason: "No citations were found in the answer.",
    }
    : invalidCitation
      ? {
        valid: false,
        citations,
        reason: `Citation does not match retrieved sources: ${invalidCitation}`,
      }
      : {
        valid: true,
        citations,
        reason: "All citations match retrieved sources.",
      };
};
