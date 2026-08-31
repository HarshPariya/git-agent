import { extractCitations } from "../guardrails/citation-check.js";
import type { AgentExecutionResult } from "../types/agent.js";
import type {
  EvaluationCase,
  EvaluationObservation,
  EvaluationReport,
  EvaluationResult,
} from "../types/evaluation.js";
import { calculateMetrics } from "./metrics.js";

export type { EvaluationReport, EvaluationResult };

const evaluateCase = (
  evaluationCase: EvaluationCase,
  result: AgentExecutionResult,
): EvaluationResult => {
  const actualRetrieval = result.sources.length > 0;
  const actualSources = result.sources.map(({ source }) => source);
  const actualCitations = extractCitations(result.text);

  const responseMatches =
    result.responseId === evaluationCase.expectedResponseId;
  const retrievalMatches = actualRetrieval === evaluationCase.expectRetrieval;
  const sourceMatches =
    evaluationCase.expectedSource === undefined ||
    actualSources.includes(evaluationCase.expectedSource);

  return {
    caseId: evaluationCase.id,
    passed: responseMatches && retrievalMatches && sourceMatches,
    expectedResponseId: evaluationCase.expectedResponseId,
    actualResponseId: result.responseId,
    expectedRetrieval: evaluationCase.expectRetrieval,
    actualRetrieval,
    ...(evaluationCase.expectedSource !== undefined && {
      expectedSource: evaluationCase.expectedSource,
    }),
    actualSources,
    ...(evaluationCase.expectedCitations !== undefined && {
      expectedCitations: evaluationCase.expectedCitations,
    }),
    ...(actualCitations.length > 0 && { actualCitations }),
  };
};

export const evaluateDataset = async (
  cases: readonly EvaluationCase[],
  run: (evaluationCase: EvaluationCase) => Promise<AgentExecutionResult>,
): Promise<EvaluationReport> => {
  const results = await Promise.all(
    cases.map(async (evaluationCase) =>
      evaluateCase(evaluationCase, await run(evaluationCase)),
    ),
  );

  const observations: EvaluationObservation[] = results.map(
    ({
      passed,
      expectedRetrieval,
      actualRetrieval,
      expectedCitations,
      actualCitations,
    }) => ({
      passed,
      expectedRetrieval,
      actualRetrieval,
      ...(expectedCitations !== undefined && { expectedCitations }),
      ...(actualCitations !== undefined && { actualCitations }),
    }),
  );

  return {
    results,
    metrics: calculateMetrics(observations),
  };
};
