import type {
  EvaluationMetrics,
  EvaluationObservation,
} from "../types/evaluation.js";

export type { EvaluationMetrics, EvaluationObservation };

export const calculateMetrics = (
  observations: readonly EvaluationObservation[],
): EvaluationMetrics => {
  const total = observations.length;
  const passed = observations.filter((item) => item.passed).length;
  const failed = total - passed;
  const retrievalChecks = observations.filter(
    (item) => item.expectedRetrieval === item.actualRetrieval,
  ).length;

  const validObservations = observations.filter(
    (
      obs,
    ): obs is EvaluationObservation & {
      expectedCitations: readonly string[];
      actualCitations: readonly string[];
    } => Boolean(obs.expectedCitations && obs.actualCitations),
  );

  const citationStats = validObservations.map((obs) => {
    const expectedSet = new Set(obs.expectedCitations);
    const actualSet = new Set(obs.actualCitations);
    const truePositives = [...actualSet].filter((c) =>
      expectedSet.has(c),
    ).length;
    const precision = actualSet.size === 0 ? 1 : truePositives / actualSet.size;
    const recall =
      expectedSet.size === 0 ? 1 : truePositives / expectedSet.size;
    return { precision, recall };
  });

  const citationCount = citationStats.length;
  const totalPrecision = citationStats.reduce(
    (acc, s) => acc + s.precision,
    0,
  );
  const totalRecall = citationStats.reduce((acc, s) => acc + s.recall, 0);

  const citationPrecision =
    citationCount === 0 ? 0 : totalPrecision / citationCount;
  const citationRecall =
    citationCount === 0 ? 0 : totalRecall / citationCount;
  const citationSum = citationPrecision + citationRecall;
  const citationF1 =
    citationSum === 0
      ? 0
      : (2 * citationPrecision * citationRecall) / citationSum;

  return {
    total,
    passed,
    failed,
    passRate: total === 0 ? 0 : passed / total,
    retrievalAccuracy: total === 0 ? 0 : retrievalChecks / total,
    citationPrecision,
    citationRecall,
    citationF1,
  };
};
