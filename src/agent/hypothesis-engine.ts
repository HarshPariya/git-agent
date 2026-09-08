export type HypothesisCategory = "SYNTAX_ERROR" | "TYPE_MISMATCH" | "NULL_UNDEFINED_DEREFERENCE" | "LOGIC_ERROR" | "REGRESSION" | "MERGE_CONFLICT" | "CI_ENVIRONMENT" | "ASYNC_RACE_CONDITION" | "RESOURCE_EXHAUSTION" | "CONTRACT_VIOLATION";
export interface Hypothesis { readonly id: string; readonly title: string; readonly description: string; readonly category: HypothesisCategory; confidence: number; status: "untested" | "supported" | "refuted"; readonly evidenceIds: string[]; rationale?: string; }
export interface EvidenceItem { readonly id: string; readonly source: "git-diff" | "git-blame" | "graphrag" | "compiler" | "test-runner" | "logs"; readonly description: string; readonly filePath?: string; readonly lineNumber?: number; readonly rawData?: unknown; }

export class HypothesisEngine {
  public generateCandidates(query: string, logs?: string): Hypothesis[] {
    const combined = `${query} ${logs ?? ""}`.toLowerCase(); const hypotheses: Hypothesis[] = [];
    if (combined.includes("cannot read properties of undefined") || combined.includes("null pointer") || combined.includes("cannot read property") || combined.includes("is undefined")) hypotheses.push({ id: "hyp-null-deref", title: "Null / Undefined Property Dereference", description: "An object property is being accessed before initialization or when an API returned null/undefined.", category: "NULL_UNDEFINED_DEREFERENCE", confidence: 0.88, status: "untested", evidenceIds: [], rationale: "Classic JavaScript/TypeScript TypeError detected in query/logs." });
    if (combined.includes("typeerror") || combined.includes("is not a function") || combined.includes("not assignable to type") || combined.includes("incompatible")) hypotheses.push({ id: "hyp-type-mismatch", title: "Contract / Type Signature Mismatch", description: "A function or interface signature changed, causing callers to pass incompatible types.", category: "TYPE_MISMATCH", confidence: 0.82, status: "untested", evidenceIds: [], rationale: "Type mismatch or invocation of non-function observed." });
    if (combined.includes("commit") || combined.includes("regression") || combined.includes("broke after") || combined.includes("latest push")) hypotheses.push({ id: "hyp-regression", title: "Recent Commit Regression", description: "A recent commit altered existing working functionality or introduced unintended side effects.", category: "REGRESSION", confidence: 0.85, status: "untested", evidenceIds: [], rationale: "Explicit mention of regression or breaking change following recent commits." });
    if (combined.includes("conflict") || combined.includes("merge") || combined.includes("rebase")) hypotheses.push({ id: "hyp-merge-conflict", title: "Merge / Rebase Conflict", description: "Two diverging branches modified overlapping sections of the same file.", category: "MERGE_CONFLICT", confidence: 0.92, status: "untested", evidenceIds: [], rationale: "Merge conflict indicators detected in context." });
    if (combined.includes("timeout") || combined.includes("unhandled promise") || combined.includes("race condition") || combined.includes("deadlock")) hypotheses.push({ id: "hyp-async-race", title: "Asynchronous Timing / Race Condition", description: "An async promise resolved out of order or timed out before dependent data was available.", category: "ASYNC_RACE_CONDITION", confidence: 0.76, status: "untested", evidenceIds: [], rationale: "Timeout or unhandled promise rejection observed." });
    if (hypotheses.length === 0) hypotheses.push({ id: "hyp-logic-error", title: "Unhandled Edge Case in Business Logic", description: "A conditional branch or boundary check is failing for specific input data.", category: "LOGIC_ERROR", confidence: 0.70, status: "untested", evidenceIds: [], rationale: "General logic defect in module execution." }, { id: "hyp-contract-violation", title: "API / Data Contract Discrepancy", description: "Expected request payload or internal parameters differ from actual values passed.", category: "CONTRACT_VIOLATION", confidence: 0.60, status: "untested", evidenceIds: [], rationale: "Caller/callee boundary divergence." });
    return this.rankHypotheses(hypotheses);
  }

  public evaluate(hypothesis: Hypothesis, evidence: EvidenceItem, supports: boolean): Hypothesis {
    const updated = { ...hypothesis };
    if (supports) { updated.confidence = Math.min(0.99, updated.confidence + 0.12); updated.status = "supported"; if (!updated.evidenceIds.includes(evidence.id)) updated.evidenceIds.push(evidence.id); }
    else { updated.confidence = Math.max(0.05, updated.confidence - 0.25); if (updated.confidence < 0.3) updated.status = "refuted"; }
    return updated;
  }

  public rankHypotheses(hypotheses: readonly Hypothesis[]): Hypothesis[] { return [...hypotheses].sort((a, b) => b.confidence - a.confidence); }
}

export const hypothesisEngine = new HypothesisEngine();
