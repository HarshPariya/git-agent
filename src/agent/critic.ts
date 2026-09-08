import { callLlm, isLlmAvailable } from "../llm/client.js";
import type { FixPlan } from "./fix-planner.js";
import type { DebugContext } from "./context-builder.js";

export type CriticVerdict = "APPROVED" | "REJECTED" | "NEEDS_REVISION";
export interface CriticFinding { readonly severity: "critical" | "major" | "minor" | "info"; readonly category: "correctness" | "security" | "performance" | "test_coverage" | "scope_creep" | "git_safety" | "regression_risk"; readonly description: string; readonly suggestion?: string; }
export interface CriticReview { readonly verdict: CriticVerdict; readonly score: number; readonly summary: string; readonly findings: readonly CriticFinding[]; readonly fixesRootCause: boolean; readonly testsAdequate: boolean; readonly gitStateSafe: boolean; readonly reviewedAt: string; }

export class CriticAgent {
  async review(plan: FixPlan, ctx: DebugContext, testsPassed: boolean): Promise<CriticReview> {
    if (await isLlmAvailable()) return this.reviewWithLlm(plan, ctx, testsPassed);
    return this.reviewDeterministic(plan, ctx, testsPassed);
  }

  private async reviewWithLlm(plan: FixPlan, ctx: DebugContext, testsPassed: boolean): Promise<CriticReview> {
    const prompt = `You are a senior software engineer conducting a critical code review.\n\nDEBUGGING TASK: ${ctx.query}\nROOT CAUSE: ${plan.rootCause}\nRISK LEVEL: ${plan.riskLevel}\nTESTS PASSED: ${testsPassed}\n\nFILES CHANGED:\n${plan.filesToChange.map((f) => `- ${f.filePath}: ${f.description}`).join("\n") || "None"}\n\nEVIDENCE USED:\n${plan.evidence.slice(0, 5).join("\n")}\n\nReview this fix and respond in JSON:\n{"verdict":"APPROVED|REJECTED|NEEDS_REVISION","score":0-100,"summary":"One paragraph review summary","findings":[{"severity":"critical|major|minor|info","category":"correctness|security|performance|test_coverage|scope_creep|git_safety|regression_risk","description":"Specific finding","suggestion":"Optional suggestion"}],"fixesRootCause":true|false,"testsAdequate":true|false,"gitStateSafe":true|false}\n\nREVIEW CRITERIA:\n- Does the fix address the actual root cause?\n- Are tests adequate?\n- Does it introduce regressions?\n- Is the scope limited to the problem?\n- Is the git state safe?\n- Are security implications considered?\n- CRITICAL findings => REJECTED\n- Score >= 80 => APPROVED\n- Score 60-79 => NEEDS_REVISION\n- Score < 60 => REJECTED`;
    try {
      const response = await callLlm([{ role: "system", content: "You are a senior code reviewer. Output only valid JSON." }, { role: "user", content: prompt }]);
      const jsonMatch = /\{[\s\S]*\}/.exec(response.content);
      if (!jsonMatch) throw new Error("No JSON");
      const parsed = JSON.parse(jsonMatch[0]) as { verdict?: CriticVerdict; score?: number; summary?: string; findings?: CriticFinding[]; fixesRootCause?: boolean; testsAdequate?: boolean; gitStateSafe?: boolean };
      return { verdict: parsed.verdict ?? "NEEDS_REVISION", score: Math.min(100, Math.max(0, parsed.score ?? 70)), summary: parsed.summary ?? "Review complete.", findings: parsed.findings ?? [], fixesRootCause: parsed.fixesRootCause ?? true, testsAdequate: parsed.testsAdequate ?? testsPassed, gitStateSafe: parsed.gitStateSafe ?? true, reviewedAt: new Date().toISOString() };
    } catch { return this.reviewDeterministic(plan, ctx, testsPassed); }
  }

  private reviewDeterministic(plan: FixPlan, _ctx: DebugContext, testsPassed: boolean): CriticReview {
    const findings: CriticFinding[] = []; let score = 75;
    if (!testsPassed) { score -= 30; findings.push({ severity: "critical", category: "correctness", description: "Tests did not pass after applying fix.", suggestion: "Investigate failing tests before approving." }); }
    if (plan.filesToChange.length === 0) { score -= 10; findings.push({ severity: "minor", category: "correctness", description: "No files were changed. Fix may be incomplete." }); }
    if (plan.riskLevel === "HIGH" || plan.riskLevel === "CRITICAL") { score -= 15; findings.push({ severity: "major", category: "git_safety", description: `Fix carries ${plan.riskLevel} risk. Manual review strongly recommended.` }); }
    const verdict: CriticVerdict = score >= 80 ? "APPROVED" : score >= 60 ? "NEEDS_REVISION" : "REJECTED";
    return { verdict, score, summary: `Deterministic review: ${verdict}. Score: ${score}/100. Tests: ${testsPassed ? "PASSED" : "FAILED"}.`, findings, fixesRootCause: true, testsAdequate: testsPassed, gitStateSafe: plan.riskLevel !== "CRITICAL", reviewedAt: new Date().toISOString() };
  }
}

export const criticAgent = new CriticAgent();
