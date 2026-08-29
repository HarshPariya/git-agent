export interface EvaluationMetrics {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly passRate: number;
  readonly retrievalAccuracy: number;
}

export interface EvaluationObservation {
  readonly passed: boolean;
  readonly expectedRetrieval: boolean;
  readonly actualRetrieval: boolean;
}

export const calculateMetrics = (
  observations: readonly EvaluationObservation[],
): EvaluationMetrics => {
  const total = observations.length;
  const passed = observations.filter((item) => item.passed).length;
  const failed = total - passed;

  const retrievalChecks = observations.filter(
    (item) => item.expectedRetrieval === item.actualRetrieval,
  ).length;

  return {
    total,
    passed,
    failed,
    passRate: total === 0 ? 0 : passed / total,
    retrievalAccuracy: total === 0 ? 0 : retrievalChecks / total,
  };
};
