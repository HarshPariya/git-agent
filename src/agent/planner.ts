import { logger } from "../logging/logger.js";

export type TaskClass =
  | "BUG"
  | "TEST_FAILURE"
  | "MERGE_CONFLICT"
  | "REGRESSION"
  | "PERFORMANCE"
  | "SECURITY"
  | "CONFIGURATION"
  | "RUNTIME_ERROR"
  | "CODE_REVIEW"
  | "EXPLORATION";

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
  readonly patterns: ReadonlyArray<RegExp>;
  readonly classification: TaskClassification;
}

const DEFAULT_CLASSIFICATION: TaskClassification = {
  taskClass: "BUG",
  complexity: "moderate",
  requiresApproval: true,
};

const CLASSIFICATION_PATTERNS: ReadonlyArray<ClassificationPattern> = [
  {
    patterns: [/\b(merge|rebase)\s+(conflict|issue|problem|clash)\b/i, /\bconflicts?\b.*\b(merge|rebase)\b/i, /\bmerge\s+conflict/i, /\bresolve\s+conflict/i],
    classification: { taskClass: "MERGE_CONFLICT", complexity: "moderate", requiresApproval: true },
  },
  {
    patterns: [/\b(test|spec)\s+(fail|failure|error|broken|crash)\b/i, /\bfail(ing|ed)?\s+(test|spec|assertion)\b/i, /\bassertion\s+error/i, /\btest\s+(suite|runner)\s+(fail|error|broken)\b/i, /\b(\d+)\s+test(s)?\s+fail/i, /\bexpect(ed)?\s+(.*?)\s+but\s+(got|received)/i],
    classification: { taskClass: "TEST_FAILURE", complexity: "simple", requiresApproval: false },
  },
  {
    patterns: [/\bregression\b/i, /\bbroke(n)?\s+(after|in|by)\b/i, /\bworked?\s+before\b/i, /\bused\s+to\s+work\b/i, /\bbisect\b/i],
    classification: { taskClass: "REGRESSION", complexity: "complex", requiresApproval: true },
  },
  {
    patterns: [/\b(null|undefined)\s*(pointer|reference|error|deref)\b/i, /\btype\s*error\b/i, /\bcannot\s+read\s+propert/i, /\b(untime|runtime)\s*(error|exception)\b/i, /\bstack\s*trace\b/i, /\bexception\s+(at|in|on)\b/i, /\bcrash(es|ed|ing)?\b.*\b(code|app|server|process)\b/i],
    classification: { taskClass: "RUNTIME_ERROR", complexity: "moderate", requiresApproval: false },
  },
  {
    patterns: [/\b(slow|sluggish|latency|performance)\b/i, /\b(memory|cpu|resource)\s*(leak|usage|spike|exhaustion)\b/i, /\btimeout(s|ed|ing)?\b/i, /\bO(n|log|time|space)\b/i],
    classification: { taskClass: "PERFORMANCE", complexity: "complex", requiresApproval: true },
  },
  {
    patterns: [/\b(security|vulnerability|CVE|injection|XSS|CSRF|auth\s*bypass)\b/i, /\b(SQL|noSQL|command)\s+injection\b/i, /\bunsafe\b.*\b(code|function|eval)\b/i],
    classification: { taskClass: "SECURITY", complexity: "complex", requiresApproval: true },
  },
  {
    patterns: [/\b(config|configuration)\s*(error|issue|problem|missing|wrong)\b/i, /\.env\b.*\b(missing|wrong|error|not found)\b/i, /\btsconfig\b.*\b(error|issue)\b/i, /\b(docker|container)\s*(error|fail|build)\b/i, /\bbuild\s+(error|fail|broken)\b/i],
    classification: { taskClass: "CONFIGURATION", complexity: "simple", requiresApproval: false },
  },
  {
    patterns: [/\b(review|reviewing|audit|review\s+code)\b/i, /\bpull\s+request\b.*\b(review|check|analyze)\b/i, /\bcode\s+review\b/i],
    classification: { taskClass: "CODE_REVIEW", complexity: "moderate", requiresApproval: false },
  },
];

function generateSummary(taskClass: TaskClass, query: string, repoName: string | undefined): string {
  const querySnippet = query.length > 120 ? `${query.slice(0, 117)}...` : query;
  const repoContext = repoName ? ` in ${repoName}` : "";

  switch (taskClass) {
    case "TEST_FAILURE":
      return `Test failure detected${repoContext}: "${querySnippet}". Investigating test suite, assertion logic, and recent changes that may have caused the failure.`;
    case "MERGE_CONFLICT":
      return `Merge conflict identified${repoContext}: "${querySnippet}". Analyzing conflicting changes across branches to determine resolution strategy.`;
    case "REGRESSION":
      return `Regression detected${repoContext}: "${querySnippet}". Tracing recently changed code paths that broke existing functionality.`;
    case "RUNTIME_ERROR":
      return `Runtime error found${repoContext}: "${querySnippet}". Analyzing stack trace, exception origin, and calling context.`;
    case "PERFORMANCE":
      return `Performance issue reported${repoContext}: "${querySnippet}". Profiling code paths to identify bottlenecks and resource usage.`;
    case "SECURITY":
      return `Security concern identified${repoContext}: "${querySnippet}". Scanning for vulnerability patterns and unsafe code execution paths.`;
    case "CONFIGURATION":
      return `Configuration issue detected${repoContext}: "${querySnippet}". Checking environment setup, build config, and dependency resolution.`;
    case "CODE_REVIEW":
      return `Code review requested${repoContext}: "${querySnippet}". Analyzing code quality, patterns, and potential improvements.`;
    case "EXPLORATION":
      return `Codebase exploration requested${repoContext}: "${querySnippet}". Scanning repository structure, symbols, and dependencies.`;
    case "BUG":
    default:
      return `Bug investigation for: "${querySnippet}"${repoContext}. Analyzing code behavior, tracing execution paths, and identifying the root cause.`;
  }
}

function getStepsForClassification(taskClass: TaskClass): readonly InvestigationStep[] {
  switch (taskClass) {
    case "TEST_FAILURE":
      return [
        { id: "step-reproduce", phase: "reproduce", title: "Identify Failing Test", description: "Locate the failing test, parse assertion error, and identify expected vs actual output.", estimatedSeconds: 20 },
        { id: "step-isolate", phase: "isolate", title: "Isolate Test Dependency", description: "Trace test imports, mocks, and fixtures to identify which code path triggers the failure.", estimatedSeconds: 30 },
        { id: "step-diagnose", phase: "diagnose", title: "Diagnose Root Cause", description: "Analyze recent commits, code changes, and logic that affect the failing test path.", estimatedSeconds: 45 },
        { id: "step-fix", phase: "fix", title: "Generate Test Fix", description: "Propose minimal fix targeting the root cause while preserving existing test coverage.", estimatedSeconds: 30 },
        { id: "step-verify", phase: "verify", title: "Verify Fix", description: "Run the failing test and full regression suite to confirm no side effects.", estimatedSeconds: 20 },
      ];
    case "MERGE_CONFLICT":
      return [
        { id: "step-isolate", phase: "isolate", title: "Identify Conflicting Files", description: "Detect merge conflict markers and map which branches modified overlapping code.", estimatedSeconds: 20 },
        { id: "step-diagnose", phase: "diagnose", title: "Analyze Conflict Semantics", description: "Compare both sides of the conflict, understand intent, and determine correct resolution.", estimatedSeconds: 45 },
        { id: "step-fix", phase: "fix", title: "Resolve Conflicts", description: "Apply semantic merge resolution combining both branch intents correctly.", estimatedSeconds: 30 },
        { id: "step-verify", phase: "verify", title: "Validate Resolution", description: "Verify resolved code compiles, passes tests, and preserves both branch features.", estimatedSeconds: 20 },
      ];
    case "REGRESSION":
      return [
        { id: "step-isolate", phase: "isolate", title: "Bisect Regression Window", description: "Analyze recent commits to identify when the regression was introduced.", estimatedSeconds: 30 },
        { id: "step-reproduce", phase: "reproduce", title: "Confirm Regression", description: "Reproduce the issue on current code and verify it worked before the identified commit.", estimatedSeconds: 30 },
        { id: "step-diagnose", phase: "diagnose", title: "Identify Breaking Change", description: "Diff the regression-introducing commit to pinpoint the exact breaking change.", estimatedSeconds: 45 },
        { id: "step-fix", phase: "fix", title: "Generate Regression Fix", description: "Create a targeted fix that restores the previous behavior without reintroducing the original change.", estimatedSeconds: 45 },
        { id: "step-verify", phase: "verify", title: "Verify No Side Effects", description: "Run full test suite and validate the fix doesn't break other features.", estimatedSeconds: 30 },
      ];
    case "RUNTIME_ERROR":
      return [
        { id: "step-isolate", phase: "isolate", title: "Parse Stack Trace", description: "Analyze stack trace, identify error origin, and map to source file and line number.", estimatedSeconds: 20 },
        { id: "step-reproduce", phase: "reproduce", title: "Trigger Error Condition", description: "Reproduce the error with the same input/state that triggered the original failure.", estimatedSeconds: 25 },
        { id: "step-diagnose", phase: "diagnose", title: "Trace Execution Path", description: "Follow the call stack from error origin to entry point, identifying the undefined/null reference.", estimatedSeconds: 45 },
        { id: "step-fix", phase: "fix", title: "Apply Defensive Fix", description: "Add null checks, type guards, or error handling at the identified failure point.", estimatedSeconds: 30 },
        { id: "step-verify", phase: "verify", title: "Validate Error Handling", description: "Verify the fix prevents the error and doesn't mask legitimate error conditions.", estimatedSeconds: 20 },
      ];
    case "PERFORMANCE":
      return [
        { id: "step-isolate", phase: "isolate", title: "Profile Hot Path", description: "Identify the slow code path, measure baseline performance, and locate bottlenecks.", estimatedSeconds: 30 },
        { id: "step-diagnose", phase: "diagnose", title: "Root Cause Analysis", description: "Analyze algorithmic complexity, memory allocations, and I/O patterns in the hot path.", estimatedSeconds: 45 },
        { id: "step-fix", phase: "fix", title: "Optimize Code Path", description: "Apply algorithmic improvements, caching, lazy loading, or resource pooling.", estimatedSeconds: 45 },
        { id: "step-verify", phase: "verify", title: "Benchmark Improvement", description: "Measure performance before and after to confirm the improvement and check for regressions.", estimatedSeconds: 30 },
      ];
    case "SECURITY":
      return [
        { id: "step-isolate", phase: "isolate", title: "Scan Vulnerability Pattern", description: "Identify the security vulnerability type, entry point, and affected code paths.", estimatedSeconds: 25 },
        { id: "step-diagnose", phase: "diagnose", title: "Assess Exploitability", description: "Evaluate attack vector, impact severity, and whether the vulnerability is currently exploitable.", estimatedSeconds: 45 },
        { id: "step-fix", phase: "fix", title: "Apply Security Patch", description: "Implement input validation, sanitization, or access controls to mitigate the vulnerability.", estimatedSeconds: 45 },
        { id: "step-verify", phase: "verify", title: "Security Validation", description: "Verify the fix blocks the attack vector and doesn't introduce new vulnerabilities.", estimatedSeconds: 30 },
      ];
    case "CODE_REVIEW":
      return [
        { id: "step-isolate", phase: "isolate", title: "Analyze Changed Files", description: "Identify modified files, understand the scope of changes, and map dependencies.", estimatedSeconds: 20 },
        { id: "step-diagnose", phase: "diagnose", title: "Review Code Quality", description: "Evaluate code patterns, naming, structure, error handling, and potential issues.", estimatedSeconds: 45 },
        { id: "step-fix", phase: "fix", title: "Suggest Improvements", description: "Generate specific improvement suggestions with code examples for identified issues.", estimatedSeconds: 30 },
        { id: "step-verify", phase: "verify", title: "Validate Suggestions", description: "Ensure suggestions are correct, maintain backward compatibility, and follow project conventions.", estimatedSeconds: 20 },
      ];
    case "EXPLORATION":
      return [
        { id: "step-isolate", phase: "isolate", title: "Map Repository Structure", description: "Scan directory layout, key files, entry points, and overall architecture.", estimatedSeconds: 20 },
        { id: "step-diagnose", phase: "diagnose", title: "Analyze Codebase", description: "Identify main components, dependencies, patterns, and architectural decisions.", estimatedSeconds: 30 },
        { id: "step-verify", phase: "verify", title: "Summarize Findings", description: "Compile a structured overview of the codebase with key insights and observations.", estimatedSeconds: 15 },
      ];
    case "CONFIGURATION":
      return [
        { id: "step-isolate", phase: "isolate", title: "Check Configuration", description: "Verify environment variables, build config, and dependency resolution.", estimatedSeconds: 20 },
        { id: "step-diagnose", phase: "diagnose", title: "Identify Misconfiguration", description: "Compare current config against expected values and project requirements.", estimatedSeconds: 30 },
        { id: "step-fix", phase: "fix", title: "Fix Configuration", description: "Correct configuration values, update environment setup, or resolve dependency issues.", estimatedSeconds: 25 },
        { id: "step-verify", phase: "verify", title: "Validate Fix", description: "Verify the application builds and runs correctly with the updated configuration.", estimatedSeconds: 20 },
      ];
    case "BUG":
    default:
      return [
        { id: "step-isolate", phase: "isolate", title: "Isolate Failing Path", description: "Inspect working tree, diff hunks, and git commit history to localize defects.", estimatedSeconds: 30 },
        { id: "step-reproduce", phase: "reproduce", title: "Reproduce Behavior", description: "Construct reproducer command, test case, or mock input payload.", estimatedSeconds: 45 },
        { id: "step-diagnose", phase: "diagnose", title: "Diagnose Root Cause", description: "Evaluate candidate hypotheses using code graph references, AST symbols, and git blame.", estimatedSeconds: 60 },
        { id: "step-fix", phase: "fix", title: "Generate Safe Patch", description: "Synthesize minimal, targeted patch with safety evaluation and reversibility guarantees.", estimatedSeconds: 45 },
        { id: "step-verify", phase: "verify", title: "Critic Safety & Tests", description: "Validate syntax correctness, run regression tests, and perform critic safety score review.", estimatedSeconds: 30 },
      ];
  }
}

export class TaskPlanner {
  classify(query: string, repoPath?: string): InvestigationPlan {
    const classification = this.matchClassification(query);
    const repoName = repoPath?.split(/[/\\]/).pop();
    const summary = generateSummary(classification.taskClass, query, repoName);
    const steps = getStepsForClassification(classification.taskClass);

    logger.info("Investigation plan formulated", {
      operation: "task-classify",
      metadata: {
        taskClass: classification.taskClass,
        complexity: classification.complexity,
        requiresApproval: classification.requiresApproval,
        queryLength: query.length,
      },
    });

    return {
      taskClass: classification.taskClass,
      confidence: 0.92,
      summary,
      estimatedComplexity: classification.complexity,
      requiresApproval: classification.requiresApproval,
      steps,
    };
  }

  private matchClassification(query: string): TaskClassification {
    for (const { patterns, classification } of CLASSIFICATION_PATTERNS) {
      if (patterns.some((pattern) => pattern.test(query))) {
        return classification;
      }
    }
    return DEFAULT_CLASSIFICATION;
  }
}

export const taskPlanner = new TaskPlanner();

export function classifyTask(query: string) {
  const plan = taskPlanner.classify(query);
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

export function generateInvestigationPlan(
  query: string,
  repoPath?: string
): InvestigationPlan {
  return taskPlanner.classify(query, repoPath);
}
