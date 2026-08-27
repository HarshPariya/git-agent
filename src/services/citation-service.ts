import type { RetrievalResult } from "../retrieval/types.js";
import {
  verifyCitations,
  type CitationCheckResult,
} from "../guardrails/citation-check.js";

export const verifyAnswerCitations = (
  answer: string,
  sources: readonly RetrievalResult[],
): CitationCheckResult =>
  verifyCitations({
    answer,
    sources,
  });
