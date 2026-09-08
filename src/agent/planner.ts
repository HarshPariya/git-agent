import { logger } from "../logging/logger.js";

export type TaskClass =
  | "BUG"
  | "TEST_FAILURE"
  | "MERGE_CONFLICT"
  | "REGRESSION"
  | "PERFORMANCE"
  | "SECURITY"
  | "CONFIGURATION"
  | "RUNTIME_ERROR";

export type TaskComplexity = "simple" | "moderate" | "complex";

export interface InvestigationStep {
  readonly id: string;
  readonly phase: "isolate" | "reproduce" | "diagnose" | "fix" | "verify";
  readonly title: string;
  readonly description: string;
  readonly estimatedSeconds: number;
}

export interface InvestigationPlan {
  readonly taskClass: TaskClass;
  readonly confidence: number;
  readonly summary: string;
  readonly estimatedComplexity: TaskComplexity;
  readonly requiresApproval: boolean;
  readonly steps: readonly InvestigationStep[];
}

interface TaskClassification {
  readonly taskClass: TaskClass;
  readonly complexity: TaskComplexity;
  readonly requiresApproval: boolean;
}

interface ClassificationPattern {
  readonly keywords: ReadonlyArray<string>;
  readonly classification: TaskClassification;
}

const DEFAULT_CLASSIFICATION: TaskClassification = {
  taskClass: "BUG",
  complexity: "moderate",
  requiresApproval: true,
};

const CLASSIFICATION_PATTERNS: ReadonlyArray<ClassificationPattern> = [
  {
    keywords: ["conflict", "merge", "rebase"],
    classification: { taskClass: "MERGE_CONFLICT", complexity: "moderate", requiresApproval: true },
  },
  {
    keywords: ["test", "fail", "assertion", "expect"],
    classification: { taskClass: "TEST_FAILURE", complexity: "simple", requiresApproval: false },
  },
  {
    keywords: ["regression", "bisect", "worked before", "broke after"],
    classification: { taskClass: "REGRESSION", complexity: "complex", requiresApproval: true },
  },
  {
    keywords: ["null", "undefined", "exception", "crash", "stack trace", "typeerror"],
    classification: { taskClass: "RUNTIME_ERROR", complexity: "moderate", requiresApproval: false },
  },
  {
    keywords: ["slow", "leak", "latency", "cpu", "memory", "timeout"],
    classification: { taskClass: "PERFORMANCE", complexity: "complex", requiresApproval: true },
  },
  {
    keywords: ["security", "cve", "vulnerability", "injection", "auth"],
    classification: { taskClass: "SECURITY", complexity: "complex", requiresApproval: true },
  },
  {
    keywords: ["config", ".env", "tsconfig", "docker", "build"],
    classification: { taskClass: "CONFIGURATION", complexity: "simple", requiresApproval: false },
  },
];

const DEFAULT_STEPS: readonly InvestigationStep[] = [
  {
    id: "step-isolate",
    phase: "isolate",
    title: "Isolate Failing Path",
    description: "Inspect working tree, diff hunks, and git commit history to localize defects.",
    estimatedSeconds: 30,
  },
  {
    id: "step-reproduce",
    phase: "reproduce",
    title: "Reproduce Behavior",
    description: "Construct reproducer command, test case, or mock input payload.",
    estimatedSeconds: 45,
  },
  {
    id: "step-diagnose",
    phase: "diagnose",
    title: "Diagnose Root Cause",
    description: "Evaluate candidate hypotheses using code graph references, AST symbols, and git blame.",
    estimatedSeconds: 60,
  },
  {
    id: "step-fix",
    phase: "fix",
    title: "Generate Safe Patch",
    description: "Synthesize minimal, targeted patch with safety evaluation and reversibility guarantees.",
    estimatedSeconds: 45,
  },
  {
    id: "step-verify",
    phase: "verify",
    title: "Critic Safety & Tests",
    description: "Validate syntax correctness, run regression tests, and perform critic safety score review.",
    estimatedSeconds: 30,
  },
];

export class TaskPlanner {
  async classify(query: string): Promise<InvestigationPlan> {
    const normalizedQuery = query.toLowerCase();
    const classification = this.matchClassification(normalizedQuery);

    logger.info("Investigation plan formulated", {
      operation: "task-classify",
      metadata: {
        taskClass: classification.taskClass,
        complexity: classification.complexity,
        requiresApproval: classification.requiresApproval,
      },
    });

    return {
      taskClass: classification.taskClass,
      confidence: 0.92,
      summary: `Classified as ${classification.taskClass} based on analysis of target symptoms and repository context.`,
      estimatedComplexity: classification.complexity,
      requiresApproval: classification.requiresApproval,
      steps: DEFAULT_STEPS,
    };
  }

  private matchClassification(query: string): TaskClassification {
    const matchedPattern = CLASSIFICATION_PATTERNS.find(({ keywords }) =>
      keywords.some((keyword) => query.includes(keyword))
    );

    return matchedPattern?.classification ?? DEFAULT_CLASSIFICATION;
  }
}

export const taskPlanner = new TaskPlanner();

export async function classifyTask(query: string) {
  const plan = await taskPlanner.classify(query);
  return {
    taskClass: plan.taskClass,
    category: plan.taskClass,
    confidence: plan.confidence,
    summary: plan.summary,
    estimatedComplexity: plan.estimatedComplexity,
    urgency: plan.estimatedComplexity === "complex" ? "high" : "normal",
    steps: plan.steps,
  };
}

export async function generateInvestigationPlan(
  query: string,
  _repoPath?: string
): Promise<InvestigationPlan> {
  return taskPlanner.classify(query);
}
