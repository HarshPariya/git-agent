export type HypothesisCategory =
  | "SYNTAX_ERROR"
  | "TYPE_MISMATCH"
  | "NULL_UNDEFINED_DEREFERENCE"
  | "LOGIC_ERROR"
  | "REGRESSION"
  | "MERGE_CONFLICT"
  | "CI_ENVIRONMENT"
  | "ASYNC_RACE_CONDITION"
  | "RESOURCE_EXHAUSTION"
  | "CONTRACT_VIOLATION";

export interface Hypothesis {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly category: HypothesisCategory;
  confidence: number;
  status: "untested" | "supported" | "refuted";
  readonly evidenceIds: string[];
  rationale?: string;
}

export interface EvidenceItem {
  readonly id: string;
  readonly source: "git-diff" | "git-blame" | "graphrag" | "compiler" | "test-runner" | "logs";
  readonly description: string;
  readonly filePath?: string;
  readonly lineNumber?: number;
  readonly rawData?: unknown;
}

interface HypothesisPattern {
  readonly patterns: ReadonlyArray<string>;
  readonly hypothesis: Omit<Hypothesis, "status" | "evidenceIds">;
}

const HYPOTHESIS_PATTERNS: ReadonlyArray<HypothesisPattern> = [
  {
    patterns: ["cannot read properties of undefined", "null pointer", "cannot read property", "is undefined"],
    hypothesis: {
      id: "hyp-null-deref",
      title: "Null / Undefined Property Dereference",
      description: "An object property is being accessed before initialization or when an API returned null/undefined.",
      category: "NULL_UNDEFINED_DEREFERENCE",
      confidence: 0.88,
      rationale: "Classic JavaScript/TypeScript TypeError detected in query/logs.",
    },
  },
  {
    patterns: ["typeerror", "is not a function", "not assignable to type", "incompatible"],
    hypothesis: {
      id: "hyp-type-mismatch",
      title: "Contract / Type Signature Mismatch",
      description: "A function or interface signature changed, causing callers to pass incompatible types.",
      category: "TYPE_MISMATCH",
      confidence: 0.82,
      rationale: "Type mismatch or invocation of non-function observed.",
    },
  },
  {
    patterns: ["commit", "regression", "broke after", "latest push"],
    hypothesis: {
      id: "hyp-regression",
      title: "Recent Commit Regression",
      description: "A recent commit altered existing working functionality or introduced unintended side effects.",
      category: "REGRESSION",
      confidence: 0.85,
      rationale: "Explicit mention of regression or breaking change following recent commits.",
    },
  },
  {
    patterns: ["conflict", "merge", "rebase"],
    hypothesis: {
      id: "hyp-merge-conflict",
      title: "Merge / Rebase Conflict",
      description: "Two diverging branches modified overlapping sections of the same file.",
      category: "MERGE_CONFLICT",
      confidence: 0.92,
      rationale: "Merge conflict indicators detected in context.",
    },
  },
  {
    patterns: ["timeout", "unhandled promise", "race condition", "deadlock"],
    hypothesis: {
      id: "hyp-async-race",
      title: "Asynchronous Timing / Race Condition",
      description: "An async promise resolved out of order or timed out before dependent data was available.",
      category: "ASYNC_RACE_CONDITION",
      confidence: 0.76,
      rationale: "Timeout or unhandled promise rejection observed.",
    },
  },
];

const FALLBACK_HYPOTHESES: ReadonlyArray<Omit<Hypothesis, "status" | "evidenceIds">> = [
  {
    id: "hyp-logic-error",
    title: "Unhandled Edge Case in Business Logic",
    description: "A conditional branch or boundary check is failing for specific input data.",
    category: "LOGIC_ERROR",
    confidence: 0.70,
    rationale: "General logic defect in module execution.",
  },
  {
    id: "hyp-contract-violation",
    title: "API / Data Contract Discrepancy",
    description: "Expected request payload or internal parameters differ from actual values passed.",
    category: "CONTRACT_VIOLATION",
    confidence: 0.60,
    rationale: "Caller/callee boundary divergence.",
  },
];

const asHypothesis = (template: Omit<Hypothesis, "status" | "evidenceIds">): Hypothesis => ({
  ...template,
  status: "untested",
  evidenceIds: [],
});

export class HypothesisEngine {
  generateCandidates(query: string, logs?: string): Hypothesis[] {
    const combined = `${query} ${logs ?? ""}`.toLowerCase();
    const matchedHypotheses = this.matchPatterns(combined);

    const hypotheses = matchedHypotheses.length > 0
      ? matchedHypotheses.map(asHypothesis)
      : FALLBACK_HYPOTHESES.map(asHypothesis);

    return this.rankHypotheses(hypotheses);
  }

  private matchPatterns(combined: string): Array<Omit<Hypothesis, "status" | "evidenceIds">> {
    const matched: Array<Omit<Hypothesis, "status" | "evidenceIds">> = [];

    for (const { patterns, hypothesis } of HYPOTHESIS_PATTERNS) {
      if (patterns.some((pattern) => combined.includes(pattern))) {
        matched.push(hypothesis);
      }
    }

    return matched;
  }

  evaluate(hypothesis: Hypothesis, evidence: EvidenceItem, supports: boolean): Hypothesis {
    const updated = { ...hypothesis };

    if (supports) {
      updated.confidence = Math.min(0.99, updated.confidence + 0.12);
      updated.status = "supported";
      if (!updated.evidenceIds.includes(evidence.id)) {
        updated.evidenceIds.push(evidence.id);
      }
      return updated;
    }

    updated.confidence = Math.max(0.05, updated.confidence - 0.25);
    if (updated.confidence < 0.3) {
      updated.status = "refuted";
    }
    return updated;
  }

  rankHypotheses(hypotheses: readonly Hypothesis[]): Hypothesis[] {
    return [...hypotheses].sort((a, b) => b.confidence - a.confidence);
  }
}

export const hypothesisEngine = new HypothesisEngine();
