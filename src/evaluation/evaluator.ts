import type { AgentExecutionResult } from "../agent/types.js";
import type { EvaluationCase } from "./dataset.js";
import {
  calculateMetrics,
  type EvaluationMetrics,
  type EvaluationObservation,
} from "./metrics.js";

export interface EvaluationResult {
  readonly caseId: string;
  readonly passed: boolean;
  readonly expectedResponseId: string;
  readonly actualResponseId: string;
  readonly expectedRetrieval: boolean;
  readonly actualRetrieval: boolean;
  readonly expectedSource?: string;
  readonly actualSources: readonly string[];
}

const evaluateCase = (
  evaluationCase: EvaluationCase,
  result: AgentExecutionResult,
): EvaluationResult => {
  const actualRetrieval = result.sources.length > 0;

  const actualSources = result.sources.map(({ source }) => source);

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
  };
};

export interface EvaluationReport {
  readonly results: readonly EvaluationResult[];
  readonly metrics: EvaluationMetrics;
}

export const evaluateDataset = async (
  cases: readonly EvaluationCase[],
  run: (evaluationCase: EvaluationCase) => Promise<AgentExecutionResult>,
): Promise<EvaluationReport> => {
  const results: EvaluationResult[] = [];

  for (const evaluationCase of cases) {
    const result = await run(evaluationCase);
    results.push(evaluateCase(evaluationCase, result));
  }

  const observations: EvaluationObservation[] = results.map(
    ({ passed, expectedRetrieval, actualRetrieval }) => ({
      passed,
      expectedRetrieval,
      actualRetrieval,
    }),
  );

  return {
    results,
    metrics: calculateMetrics(observations),
  };
};
