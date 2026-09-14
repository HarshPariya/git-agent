import type { Hypothesis, EvidenceItem } from "./hypothesis-engine.js";

export type RiskLevel = "low" | "medium" | "high";

export interface RootCauseReport {
  readonly id: string;
  readonly symptom: string;
  readonly rootCause: string;
  readonly winningHypothesis: Hypothesis;
  readonly evidenceChain: readonly EvidenceItem[];
  readonly affectedFiles: readonly string[];
  readonly fixStrategy: string;
  readonly riskLevel: RiskLevel;
  readonly confidence: number;
  readonly generatedAt: string;
}

interface RiskPattern {
  readonly matcher: (hypothesis: Hypothesis, affectedFiles: readonly string[]) => boolean;
  readonly level: RiskLevel;
}

const DEFAULT_HYPOTHESIS: Hypothesis = {
  id: "hyp-generic",
  title: "Unexpected defect in execution flow",
  description: "Code logic defect encountered during execution.",
  category: "LOGIC_ERROR",
  confidence: 0.65,
  status: "supported",
  evidenceIds: [],
};

const FIX_STRATEGIES: ReadonlyMap<string, string> = new Map([
  ["NULL_UNDEFINED_DEREFERENCE", "Add defensive optional chaining (?.) and strict null check guards."],
  ["TYPE_MISMATCH", "Harmonize parameter signatures between caller and callee interfaces."],
  ["MERGE_CONFLICT", "Integrate conflicting changes while preserving both upstream fixes."],
  ["REGRESSION", "Revert breaking logic change while maintaining target functionality."],
  ["ASYNC_RACE_CONDITION", "Ensure explicit await resolution and mutex/locking bounds."],
]);

const DEFAULT_FIX_STRATEGY = "Refine boundary conditions and handle unexpected input values safely.";

const SECURITY_AUTH_DB_PATTERN = /security|auth|db/i;

const RISK_PATTERNS: ReadonlyArray<RiskPattern> = [
  {
    matcher: (h) => ["MERGE_CONFLICT", "REGRESSION"].includes(h.category),
    level: "medium",
  },
  {
    matcher: (_h, files) => files.length > 3,
    level: "medium",
  },
  {
    matcher: (_h, files) => files.some((f) => SECURITY_AUTH_DB_PATTERN.test(f)),
    level: "medium",
  },
];

export class RootCauseAnalyzer {
  synthesize(
    symptom: string,
    hypotheses: readonly Hypothesis[],
    evidence: readonly EvidenceItem[],
    affectedFiles: readonly string[] = [],
  ): RootCauseReport {
    const winning = this.selectWinningHypothesis(hypotheses);
    const relevantEvidence = this.filterRelevantEvidence(evidence, winning);
    const riskLevel = this.determineRiskLevel(winning, affectedFiles);
    const fixStrategy = this.selectFixStrategy(winning.category);

    return {
      id: `rc-${crypto.randomUUID().slice(0, 8)}`,
      symptom,
      rootCause: winning.description,
      winningHypothesis: winning,
      evidenceChain: relevantEvidence.length > 0 ? relevantEvidence : evidence,
      affectedFiles,
      fixStrategy,
      riskLevel,
      confidence: winning.confidence,
      generatedAt: new Date().toISOString(),
    };
  }

  private selectWinningHypothesis(hypotheses: readonly Hypothesis[]): Hypothesis {
    const sorted = [...hypotheses].sort((a, b) => b.confidence - a.confidence);
    return sorted[0] ?? DEFAULT_HYPOTHESIS;
  }

  private filterRelevantEvidence(
    evidence: readonly EvidenceItem[],
    winningHypothesis: Hypothesis,
  ): readonly EvidenceItem[] {
    if (winningHypothesis.evidenceIds.length === 0) {
      return evidence;
    }
    return evidence.filter((e) => winningHypothesis.evidenceIds.includes(e.id));
  }

  private determineRiskLevel(hypothesis: Hypothesis, affectedFiles: readonly string[]): RiskLevel {
    const matchedPattern = RISK_PATTERNS.find((pattern) => pattern.matcher(hypothesis, affectedFiles));
    return matchedPattern?.level ?? "low";
  }

  private selectFixStrategy(category: string): string {
    return FIX_STRATEGIES.get(category) ?? DEFAULT_FIX_STRATEGY;
  }
}

export const rootCauseAnalyzer = new RootCauseAnalyzer();
