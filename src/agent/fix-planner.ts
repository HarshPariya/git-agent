import { callLlm, isLlmAvailable } from "../llm/client.js";
import type { DebugContext } from "./context-builder.js";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export interface FileChange { readonly filePath: string; readonly description: string; readonly patch: string; readonly linesAffected: number; }
export interface FixPlan { readonly id: string; readonly problem: string; readonly rootCause: string; readonly evidence: string[]; readonly filesToChange: FileChange[]; readonly testsToRun: string[]; readonly riskLevel: RiskLevel; readonly requiresApproval: boolean; readonly autoApprovePolicy: boolean; readonly estimatedImpact: string; readonly rollbackStrategy: string; readonly createdAt: string; }
export interface FixPlanStatus { readonly planId: string; readonly status: "pending_approval" | "approved" | "rejected" | "applied" | "rolled_back"; readonly approvedBy?: string; readonly approvedAt?: string; }

const fixPlanStore = new Map<string, FixPlan>();
const fixPlanStatus = new Map<string, FixPlanStatus>();

export class FixPlanner {
  async generate(ctx: DebugContext, rootCause: string, evidence: string[], hypotheses?: string[]): Promise<FixPlan> {
    const id = `fix-${crypto.randomUUID().slice(0, 8)}`;
    const useLlm = await isLlmAvailable();
    const plan = useLlm ? await this.generateWithLlm(id, ctx, rootCause, evidence, hypotheses ?? []) : this.generateFallback(id, ctx, rootCause, evidence);
    fixPlanStore.set(id, plan); fixPlanStatus.set(id, { planId: id, status: plan.requiresApproval ? "pending_approval" : "approved" });
    return plan;
  }

  private async generateWithLlm(id: string, ctx: DebugContext, rootCause: string, evidence: string[], hypotheses: string[]): Promise<FixPlan> {
    const prompt = `You are an expert software engineer generating a precise fix plan.\n\nREPOSITORY: ${ctx.repositoryName}\nBRANCH: ${ctx.git.branch}\nROOT CAUSE: ${rootCause}\n\nEVIDENCE:\n${evidence.map((e, i) => `${i + 1}. ${e}`).join("\n")}\n\nHYPOTHESES CONSIDERED:\n${hypotheses.map((h, i) => `${i + 1}. ${h}`).join("\n") || "None"}\n\nCHANGED FILES:\n${ctx.git.diff.slice(0, 1500)}\n\nGenerate a JSON fix plan with this structure:\n{"problem":"short problem statement","rootCause":"precise root cause","filesToChange":[{"filePath":"relative/path/to/file.ts","description":"what needs to change","patch":"// pseudo-code diff or description of change","linesAffected":5}],"testsToRun":["test:unit","test:integration"],"riskLevel":"LOW|MEDIUM|HIGH|CRITICAL","estimatedImpact":"Impact description","rollbackStrategy":"How to roll back if needed"}\n\nRULES:\n- Only change files absolutely necessary\n- Never change unrelated code\n- LOW risk: < 10 lines, no API changes\n- MEDIUM risk: < 50 lines, no public API changes\n- HIGH risk: API or schema changes\n- CRITICAL: force-push, history rewrite, destructive ops (never auto-approve)\n- Respond ONLY with valid JSON.`;
    try {
      const response = await callLlm([{ role: "system", content: "You are an expert software engineer. Output only valid JSON." }, { role: "user", content: prompt }]);
      const jsonMatch = /\{[\s\S]*\}/.exec(response.content);
      if (!jsonMatch) throw new Error("No JSON in LLM response");
      const parsed = JSON.parse(jsonMatch[0]) as { problem?: string; rootCause?: string; filesToChange?: FileChange[]; testsToRun?: string[]; riskLevel?: RiskLevel; estimatedImpact?: string; rollbackStrategy?: string };
      const riskLevel = parsed.riskLevel ?? "MEDIUM"; const requiresApproval = riskLevel === "HIGH" || riskLevel === "CRITICAL";
      return { id, problem: parsed.problem ?? ctx.query, rootCause: parsed.rootCause ?? rootCause, evidence, filesToChange: parsed.filesToChange ?? [], testsToRun: parsed.testsToRun ?? ["npm test"], riskLevel, requiresApproval, autoApprovePolicy: !requiresApproval, estimatedImpact: parsed.estimatedImpact ?? "Unknown", rollbackStrategy: parsed.rollbackStrategy ?? "git revert HEAD", createdAt: new Date().toISOString() };
    } catch { return this.generateFallback(id, ctx, rootCause, evidence); }
  }

  private generateFallback(id: string, ctx: DebugContext, rootCause: string, evidence: string[]): FixPlan {
    return { id, problem: ctx.query, rootCause, evidence, filesToChange: ctx.git.changedFiles.slice(0, 3).map((f) => ({ filePath: f, description: `Review and fix issue in ${f}`, patch: "// Manual review required", linesAffected: 0 })), testsToRun: ["npm test"], riskLevel: "MEDIUM", requiresApproval: false, autoApprovePolicy: true, estimatedImpact: "Resolves reported bug", rollbackStrategy: "git revert HEAD", createdAt: new Date().toISOString() };
  }

  approve(planId: string, userId: string): void { const status = fixPlanStatus.get(planId); if (!status) throw new Error(`Fix plan ${planId} not found`); fixPlanStatus.set(planId, { ...status, status: "approved", approvedBy: userId, approvedAt: new Date().toISOString() }); }
  reject(planId: string): void { const status = fixPlanStatus.get(planId); if (!status) throw new Error(`Fix plan ${planId} not found`); fixPlanStatus.set(planId, { ...status, status: "rejected" }); }
  getPlan(planId: string): FixPlan | undefined { return fixPlanStore.get(planId); }
  getStatus(planId: string): FixPlanStatus | undefined { return fixPlanStatus.get(planId); }
  isApproved(planId: string): boolean { return fixPlanStatus.get(planId)?.status === "approved"; }
}

export const fixPlanner = new FixPlanner();
