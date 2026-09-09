import { callLlm, isLlmAvailable } from "../llm/client.js";
import type { FixPlan } from "./fix-planner.js";
import type { DebugContext } from "./context-builder.js";

export type CriticVerdict = "APPROVED" | "REJECTED" | "NEEDS_REVISION";

export interface CriticFinding {
  readonly severity: "critical" | "major" | "minor" | "info";
  readonly category:
    | "correctness"
    | "security"
    | "performance"
    | "test_coverage"
    | "scope_creep"
    | "git_safety"
    | "regression_risk";
  readonly description: string;
  readonly suggestion?: string;
}

export interface CriticReview {
  readonly verdict: CriticVerdict;
  readonly score: number;
  readonly summary: string;
  readonly findings: readonly CriticFinding[];
  readonly fixesRootCause: boolean;
  readonly testsAdequate: boolean;
  readonly gitStateSafe: boolean;
  readonly reviewedAt: string;
}

const SCORE_THRESHOLDS: ReadonlyArray<{ minScore: number; verdict: CriticVerdict }> = [
  { minScore: 80, verdict: "APPROVED" },
  { minScore: 60, verdict: "NEEDS_REVISION" },
];

const DEFAULT_REVIEW: CriticReview = {
  verdict: "NEEDS_REVISION",
  score: 70,
  summary: "Review complete.",
  findings: [],
  fixesRootCause: true,
  testsAdequate: true,
  gitStateSafe: true,
  reviewedAt: new Date().toISOString(),
};

export class CriticAgent {
  async review(
    plan: FixPlan,
    ctx: DebugContext,
    testsPassed: boolean
  ): Promise<CriticReview> {
    const useLlm = isLlmAvailable();
    return useLlm
      ? this.reviewWithLlm(plan, ctx, testsPassed)
      : this.reviewDeterministic(plan, ctx, testsPassed);
  }

  private async reviewWithLlm(
    plan: FixPlan,
    ctx: DebugContext,
    testsPassed: boolean
  ): Promise<CriticReview> {
    const prompt = this.buildReviewPrompt(plan, ctx, testsPassed);

    try {
      const response = await callLlm([
        {
          role: "system",
          content: "You are a senior code reviewer. Output only valid JSON.",
        },
        { role: "user", content: prompt },
      ]);

      return this.parseLlmResponse(response.content, testsPassed);
    } catch {
      return this.reviewDeterministic(plan, ctx, testsPassed);
    }
  }

  private buildReviewPrompt(
    plan: FixPlan,
    ctx: DebugContext,
    testsPassed: boolean
  ): string {
    const filesChanged =
      plan.filesToChange.map((f) => `- ${f.filePath}: ${f.description}`).join("\n") ||
      "None";
    const evidenceUsed = plan.evidence.slice(0, 5).join("\n");

    return `You are a senior software engineer conducting a critical code review.

DEBUGGING TASK: ${ctx.query}
ROOT CAUSE: ${plan.rootCause}
RISK LEVEL: ${plan.riskLevel}
TESTS PASSED: ${testsPassed}

FILES CHANGED:
${filesChanged}

EVIDENCE USED:
${evidenceUsed}

Review this fix and respond in JSON:
{"verdict":"APPROVED|REJECTED|NEEDS_REVISION","score":0-100,"summary":"One paragraph review summary","findings":[{"severity":"critical|major|minor|info","category":"correctness|security|performance|test_coverage|scope_creep|git_safety|regression_risk","description":"Specific finding","suggestion":"Optional suggestion"}],"fixesRootCause":true|false,"testsAdequate":true|false,"gitStateSafe":true|false}

REVIEW CRITERIA:
- Does the fix address the actual root cause?
- Are tests adequate?
- Does it introduce regressions?
- Is the scope limited to the problem?
- Is the git state safe?
- Are security implications considered?
- CRITICAL findings => REJECTED
- Score >= 80 => APPROVED
- Score 60-79 => NEEDS_REVISION
- Score < 60 => REJECTED`;
  }

  private parseLlmResponse(
    content: string,
    testsPassed: boolean
  ): CriticReview {
    const jsonMatch = /\{[\s\S]*\}/.exec(content);
    if (!jsonMatch) {
      throw new Error("No JSON found in LLM response");
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      verdict?: CriticVerdict;
      score?: number;
      summary?: string;
      findings?: CriticFinding[];
      fixesRootCause?: boolean;
      testsAdequate?: boolean;
      gitStateSafe?: boolean;
    };

    return {
      verdict: parsed.verdict ?? DEFAULT_REVIEW.verdict,
      score: Math.min(100, Math.max(0, parsed.score ?? DEFAULT_REVIEW.score)),
      summary: parsed.summary ?? DEFAULT_REVIEW.summary,
      findings: parsed.findings ?? DEFAULT_REVIEW.findings,
      fixesRootCause: parsed.fixesRootCause ?? DEFAULT_REVIEW.fixesRootCause,
      testsAdequate: parsed.testsAdequate ?? testsPassed,
      gitStateSafe: parsed.gitStateSafe ?? DEFAULT_REVIEW.gitStateSafe,
      reviewedAt: new Date().toISOString(),
    };
  }

  private reviewDeterministic(
    plan: FixPlan,
    _ctx: DebugContext,
    testsPassed: boolean
  ): CriticReview {
    const findings: CriticFinding[] = [];
    let score = 75;

    score = this.applyTestPenalty(score, testsPassed, findings);
    score = this.applyEmptyChangePenalty(score, plan, findings);
    score = this.applyRiskPenalty(score, plan, findings);

    const verdict = this.determineVerdict(score);
    const summary = `Deterministic review: ${verdict}. Score: ${score}/100. Tests: ${testsPassed ? "PASSED" : "FAILED"}.`;

    return {
      verdict,
      score,
      summary,
      findings,
      fixesRootCause: true,
      testsAdequate: testsPassed,
      gitStateSafe: plan.riskLevel !== "CRITICAL",
      reviewedAt: new Date().toISOString(),
    };
  }

  private applyTestPenalty(
    score: number,
    testsPassed: boolean,
    findings: CriticFinding[]
  ): number {
    if (testsPassed) {
      return score;
    }

    findings.push({
      severity: "critical",
      category: "correctness",
      description: "Tests did not pass after applying fix.",
      suggestion: "Investigate failing tests before approving.",
    });
    return score - 30;
  }

  private applyEmptyChangePenalty(
    score: number,
    plan: FixPlan,
    findings: CriticFinding[]
  ): number {
    if (plan.filesToChange.length > 0) {
      return score;
    }

    findings.push({
      severity: "minor",
      category: "correctness",
      description: "No files were changed. Fix may be incomplete.",
    });
    return score - 10;
  }

  private applyRiskPenalty(
    score: number,
    plan: FixPlan,
    findings: CriticFinding[]
  ): number {
    if (plan.riskLevel !== "HIGH" && plan.riskLevel !== "CRITICAL") {
      return score;
    }

    findings.push({
      severity: "major",
      category: "git_safety",
      description: `Fix carries ${plan.riskLevel} risk. Manual review strongly recommended.`,
    });
    return score - 15;
  }

  private determineVerdict(score: number): CriticVerdict {
    return (
      SCORE_THRESHOLDS.find((t) => score >= t.minScore)?.verdict ?? "REJECTED"
    );
  }
}

export const criticAgent = new CriticAgent();
