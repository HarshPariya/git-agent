export interface EvaluationCase {
  readonly id: string;
  readonly question: string;
  readonly expectedResponseId: string;
  readonly expectRetrieval: boolean;
  readonly expectedSource?: string;
  readonly expectedCitations?: readonly string[];
}

export interface EvaluationObservation {
  readonly passed: boolean;
  readonly expectedRetrieval: boolean;
  readonly actualRetrieval: boolean;
  readonly expectedCitations?: readonly string[];
  readonly actualCitations?: readonly string[];
}

export interface EvaluationMetrics {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly passRate: number;
  readonly retrievalAccuracy: number;
  readonly citationPrecision: number;
  readonly citationRecall: number;
  readonly citationF1: number;
}

export interface EvaluationResult {
  readonly caseId: string;
  readonly passed: boolean;
  readonly expectedResponseId: string;
  readonly actualResponseId: string;
  readonly expectedRetrieval: boolean;
  readonly actualRetrieval: boolean;
  readonly expectedSource?: string;
  readonly actualSources: readonly string[];
  readonly expectedCitations?: readonly string[];
  readonly actualCitations?: readonly string[];
}

export interface EvaluationReport {
  readonly results: readonly EvaluationResult[];
  readonly metrics: EvaluationMetrics;
}
