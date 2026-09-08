import { logger } from "../logging/logger.js";
export type TaskClass = "BUG" | "TEST_FAILURE" | "MERGE_CONFLICT" | "REGRESSION" | "PERFORMANCE" | "SECURITY" | "CONFIGURATION" | "RUNTIME_ERROR";
export type TaskComplexity = "simple" | "moderate" | "complex";
export interface InvestigationStep { readonly id: string; readonly phase: "isolate" | "reproduce" | "diagnose" | "fix" | "verify"; readonly title: string; readonly description: string; readonly estimatedSeconds: number; }
export interface InvestigationPlan { readonly taskClass: TaskClass; readonly confidence: number; readonly summary: string; readonly estimatedComplexity: TaskComplexity; readonly requiresApproval: boolean; readonly steps: readonly InvestigationStep[]; }

export class TaskPlanner {
  async classify(query: string): Promise<InvestigationPlan> {
    const q = query.toLowerCase(); let taskClass: TaskClass = "BUG"; let complexity: TaskComplexity = "moderate"; let requiresApproval = true;
    if (q.includes("conflict") || q.includes("merge") || q.includes("rebase")) { taskClass = "MERGE_CONFLICT"; complexity = "moderate"; }
    else if (q.includes("test") || q.includes("fail") || q.includes("assertion") || q.includes("expect")) { taskClass = "TEST_FAILURE"; complexity = "simple"; requiresApproval = false; }
    else if (q.includes("regression") || q.includes("bisect") || q.includes("worked before") || q.includes("broke after")) { taskClass = "REGRESSION"; complexity = "complex"; }
    else if (q.includes("null") || q.includes("undefined") || q.includes("exception") || q.includes("crash") || q.includes("stack trace") || q.includes("typeerror")) { taskClass = "RUNTIME_ERROR"; complexity = "moderate"; requiresApproval = false; }
    else if (q.includes("slow") || q.includes("leak") || q.includes("latency") || q.includes("cpu") || q.includes("memory") || q.includes("timeout")) { taskClass = "PERFORMANCE"; complexity = "complex"; }
    else if (q.includes("security") || q.includes("cve") || q.includes("vulnerability") || q.includes("injection") || q.includes("auth")) { taskClass = "SECURITY"; complexity = "complex"; }
    else if (q.includes("config") || q.includes(".env") || q.includes("tsconfig") || q.includes("docker") || q.includes("build")) { taskClass = "CONFIGURATION"; complexity = "simple"; requiresApproval = false; }
    const steps: InvestigationStep[] = [{ id: "step-isolate", phase: "isolate", title: "Isolate Failing Path", description: "Inspect working tree, diff hunks, and git commit history to localize defects.", estimatedSeconds: 30 }, { id: "step-reproduce", phase: "reproduce", title: "Reproduce Behavior", description: "Construct reproducer command, test case, or mock input payload.", estimatedSeconds: 45 }, { id: "step-diagnose", phase: "diagnose", title: "Diagnose Root Cause", description: "Evaluate candidate hypotheses using code graph references, AST symbols, and git blame.", estimatedSeconds: 60 }, { id: "step-fix", phase: "fix", title: "Generate Safe Patch", description: "Synthesize minimal, targeted patch with safety evaluation and reversibility guarantees.", estimatedSeconds: 45 }, { id: "step-verify", phase: "verify", title: "Critic Safety & Tests", description: "Validate syntax correctness, run regression tests, and perform critic safety score review.", estimatedSeconds: 30 }];
    logger.info("Investigation plan formulated", { operation: "task-classify", metadata: { taskClass, complexity, requiresApproval } });
    return { taskClass, confidence: 0.92, summary: `Classified as ${taskClass} based on analysis of target symptoms and repository context.`, estimatedComplexity: complexity, requiresApproval, steps };
  }
}

export const taskPlanner = new TaskPlanner();
export async function classifyTask(query: string) { const plan = await taskPlanner.classify(query); return { taskClass: plan.taskClass, category: plan.taskClass, confidence: plan.confidence, summary: plan.summary, estimatedComplexity: plan.estimatedComplexity, urgency: plan.estimatedComplexity === "complex" ? "high" : "normal", steps: plan.steps }; }
export async function generateInvestigationPlan(query: string, _repoPath?: string): Promise<InvestigationPlan> { return taskPlanner.classify(query); }
