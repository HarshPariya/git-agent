/**
 * Root Cause Analyzer
 * Synthesizes validated hypotheses and evidence chains into an authoritative root cause diagnosis
 */

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

export class RootCauseAnalyzer {
  public synthesize(
    symptom: string,
    hypotheses: readonly Hypothesis[],
    evidence: readonly EvidenceItem[],
    affectedFiles: readonly string[] = [],
  ): RootCauseReport {
    // Find highest confidence hypothesis
    const sorted = [...hypotheses].sort((a, b) => b.confidence - a.confidence);
    const winning = sorted[0] ?? {
      id: "hyp-generic",
      title: "Unexpected defect in execution flow",
      description: "Code logic defect encountered during execution.",
      category: "LOGIC_ERROR",
      confidence: 0.65,
      status: "supported",
      evidenceIds: [],
    };

    // Filter evidence matching the winning hypothesis or all evidence
    const relevantEvidence = evidence.filter(
      (e) => winning.evidenceIds.length === 0 || winning.evidenceIds.includes(e.id),
    );

    // Assess risk level based on files affected and category
    let riskLevel: RiskLevel = "low";
    if (
      winning.category === "MERGE_CONFLICT" ||
      winning.category === "REGRESSION" ||
      affectedFiles.length > 3
    ) {
      riskLevel = "medium";
    }
    if (affectedFiles.some((f) => f.includes("security") || f.includes("auth") || f.includes("db"))) {
      riskLevel = "medium";
    }

    // Determine fix strategy
    let fixStrategy = "Apply minimal surgical patch and add regression tests.";
    switch (winning.category) {
      case "NULL_UNDEFINED_DEREFERENCE":
        fixStrategy = "Add defensive optional chaining (?.) and strict null check guards.";
        break;
      case "TYPE_MISMATCH":
        fixStrategy = "Harmonize parameter signatures between caller and callee interfaces.";
        break;
      case "MERGE_CONFLICT":
        fixStrategy = "Integrate conflicting changes while preserving both upstream fixes.";
        break;
      case "REGRESSION":
        fixStrategy = "Revert breaking logic change while maintaining target functionality.";
        break;
      case "ASYNC_RACE_CONDITION":
        fixStrategy = "Ensure explicit await resolution and mutex/locking bounds.";
        break;
      default:
        fixStrategy = "Refine boundary conditions and handle unexpected input values safely.";
        break;
    }

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
}

export const rootCauseAnalyzer = new RootCauseAnalyzer();
