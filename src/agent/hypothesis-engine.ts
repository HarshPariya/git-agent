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
  | "CONTRACT_VIOLATION"
  | "CONFIGURATION"
  | "PERFORMANCE"
  | "SECURITY"
  | "TEST_FAILURE";

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
  readonly patterns: ReadonlyArray<RegExp>;
  readonly hypothesis: Omit<Hypothesis, "status" | "evidenceIds">;
}

const HYPOTHESIS_PATTERNS: ReadonlyArray<HypothesisPattern> = [
  {
    patterns: [
      /\bcannot\s+read\s+propert(y|ies)\s+of\s+(undefined|null)\b/i,
      /\bnull\s*(pointer|reference|error|deref)\b/i,
      /\bis\s+undefined\b/i,
      /\bundefined\s+is\s+not\b/i,
      /\b(error|exception)\b.*\b(null|undefined)\b/i,
    ],
    hypothesis: {
      id: "hyp-null-deref",
      title: "Null / Undefined Property Dereference",
      description: "An object property is being accessed before initialization or when an API returned null/undefined.",
      category: "NULL_UNDEFINED_DEREFERENCE",
      confidence: 0.88,
      rationale: "Classic JavaScript/TypeError detected in query/logs.",
    },
  },
  {
    patterns: [
      /\btype\s*error\b/i,
      /\bis\s+not\s+a\s+function\b/i,
      /\bnot\s+assignable\s+to\s+type\b/i,
      /\bincompatible\s+type/i,
      /\bexpected\s+\w+\s+but\s+got\s+\w+/i,
    ],
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
    patterns: [
      /\bregression\b/i,
      /\bbroke(n)?\s+(after|in|by)\b/i,
      /\bworked?\s+before\b/i,
      /\bused\s+to\s+work\b/i,
      /\bcommit\b.*\b(broke|broken|issue|problem)\b/i,
      /\blatest\s+(push|commit|deploy)\b.*\b(broke|issue|fail)\b/i,
    ],
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
    patterns: [
      /\b(merge|rebase)\s+conflict\b/i,
      /\bconflict(s|ing)?\b.*\b(merge|rebase|branch)\b/i,
      /\b(merge|rebase)\b.*\b(conflict|issue|problem)\b/i,
      /\bresolve\s+conflict/i,
    ],
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
    patterns: [
      /\btimeout(s|ed|ing)?\b/i,
      /\bunhandled\s+promise\b/i,
      /\brace\s+condition\b/i,
      /\bdeadlock\b/i,
      /\bpromise\s+(reject|settle|resolv)/i,
      /\basync\b.*\b(fail|error|hang|stuck)\b/i,
    ],
    hypothesis: {
      id: "hyp-async-race",
      title: "Asynchronous Timing / Race Condition",
      description: "An async promise resolved out of order or timed out before dependent data was available.",
      category: "ASYNC_RACE_CONDITION",
      confidence: 0.76,
      rationale: "Timeout or unhandled promise rejection observed.",
    },
  },
  {
    patterns: [
      /\b(test|spec)\s+(fail|failure|error|broken)\b/i,
      /\bexpect(ed)?\s+(.*?)\s+but\s+(got|received)/i,
      /\bassert(ion)?\s+error/i,
      /\b(\d+)\s+test(s)?\s+fail/i,
    ],
    hypothesis: {
      id: "hyp-test-assertion",
      title: "Test Assertion Mismatch",
      description:
        "A test is failing because the actual output doesn't match the expected assertion. The test or the code under test changed.",
      category: "TEST_FAILURE",
      confidence: 0.87,
      rationale: "Test failure or assertion error detected in query.",
    },
  },
  {
    patterns: [
      /\b(slow|sluggish|latency|performance)\b/i,
      /\bmemory\s*(leak|usage|spike)\b/i,
      /\bcpu\s*(usage|spike|high)\b/i,
      /\btimeout\b.*\b(slow|server|response)\b/i,
      /\bO\(n\s*\^?\s*2?\)\b/i,
    ],
    hypothesis: {
      id: "hyp-performance",
      title: "Performance Bottleneck",
      description:
        "An inefficient algorithm, N+1 query, or unoptimized loop is causing excessive resource consumption.",
      category: "PERFORMANCE",
      confidence: 0.78,
      rationale: "Performance-related keywords detected in query.",
    },
  },
  {
    patterns: [
      /\b(security|vulnerability|CVE|injection|XSS|CSRF)\b/i,
      /\b(SQL|noSQL|command)\s+injection\b/i,
      /\bunsafe\b.*\b(code|function|eval)\b/i,
      /\b(auth|authentication)\s*(bypass|fail|error)\b/i,
    ],
    hypothesis: {
      id: "hyp-security",
      title: "Security Vulnerability",
      description:
        "An injection, XSS, authentication bypass, or other security vulnerability may be present in the code path.",
      category: "SECURITY",
      confidence: 0.8,
      rationale: "Security-related keywords detected in query.",
    },
  },
  {
    patterns: [
      /\b(config|configuration)\s*(error|issue|missing|wrong)\b/i,
      /\.env\b.*\b(missing|wrong|error|not found)\b/i,
      /\btsconfig\b.*\b(error|issue)\b/i,
      /\bbuild\s+(error|fail|broken)\b/i,
      /\bmodule\s+not\s+found\b/i,
    ],
    hypothesis: {
      id: "hyp-config",
      title: "Configuration / Environment Issue",
      description:
        "A missing or incorrect environment variable, build config, or dependency resolution is causing failures.",
      category: "CONFIGURATION",
      confidence: 0.83,
      rationale: "Configuration-related error detected in query.",
    },
  },
];

function generateQueryFallbacks(query: string): Array<Omit<Hypothesis, "status" | "evidenceIds">> {
  const q = query.toLowerCase();
  const fallbacks: Array<Omit<Hypothesis, "status" | "evidenceIds">> = [];

  if (/\b(bug|error|fail|crash|issue|problem|broken|wrong|not work)\b/i.test(q)) {
    const fileHint = q.match(/(\w+\.\w{1,5})\b/);
    const fileContext = fileHint ? ` in ${fileHint[1]}` : "";
    fallbacks.push({
      id: "hyp-general-bug",
      title: `Logic Error${fileContext}`,
      description: `Investigation of "${query.slice(0, 100)}" points to an unexpected code path or incorrect conditional logic${fileContext}. Tracing execution to identify where actual behavior diverges from expected.`,
      category: "LOGIC_ERROR",
      confidence: 0.65,
      rationale:
        "General bug report pattern detected — no specific error signature matched, so a logic error is the most likely root cause.",
    });
  }

  if (/\b(test|spec|assert|expect|describe|it\()\b/i.test(q)) {
    fallbacks.push({
      id: "hyp-test-issue",
      title: "Test Logic or Fixture Issue",
      description:
        "The test itself may have incorrect assertions, stale fixtures, or mock setup that doesn't reflect current code behavior.",
      category: "TEST_FAILURE",
      confidence: 0.68,
      rationale: "Test-related query — failure may stem from the test code rather than the code under test.",
    });
  }

  if (/\b(deploy|build|ci|pipeline|docker|server)\b/i.test(q)) {
    fallbacks.push({
      id: "hyp-deploy-issue",
      title: "Deployment / Build Environment Issue",
      description:
        "A difference between local and remote build environments, missing dependencies, or incorrect build configuration is causing the issue.",
      category: "CONFIGURATION",
      confidence: 0.62,
      rationale: "Deployment/build context detected — environment differences are a common source of failures.",
    });
  }

  if (/\b(api|endpoint|route|request|response|fetch|http)\b/i.test(q)) {
    fallbacks.push({
      id: "hyp-api-contract",
      title: "API Contract or Request/Response Mismatch",
      description:
        "The API endpoint may be returning unexpected data, or the client may be sending incorrect parameters. Checking request/response formats and status codes.",
      category: "CONTRACT_VIOLATION",
      confidence: 0.64,
      rationale: "API-related query — contract violations between client and server are common failure modes.",
    });
  }

  if (/\b(database|db|mongo|postgres|query|sql)\b/i.test(q)) {
    fallbacks.push({
      id: "hyp-database-issue",
      title: "Database Query or Connection Issue",
      description:
        "A malformed query, missing index, connection pool exhaustion, or schema mismatch may be causing the database-related failure.",
      category: "RESOURCE_EXHAUSTION",
      confidence: 0.66,
      rationale:
        "Database-related keywords detected — query or connection issues are the most common database failures.",
    });
  }

  if (/\b(auth|login|token|session|permission|role)\b/i.test(q)) {
    fallbacks.push({
      id: "hyp-auth-issue",
      title: "Authentication / Authorization Logic Error",
      description:
        "Token validation, session management, or role-based permission checks may be failing or rejecting valid requests.",
      category: "LOGIC_ERROR",
      confidence: 0.67,
      rationale: "Auth-related query — permission or token validation logic is a frequent source of subtle bugs.",
    });
  }

  if (fallbacks.length === 0) {
    const querySnippet = query.length > 80 ? `${query.slice(0, 77)}...` : query;
    fallbacks.push({
      id: "hyp-contextual-bug",
      title: `Code Behavior Issue: "${querySnippet}"`,
      description: `Investigating the reported issue: "${query}". Examining relevant code paths, recent changes, and potential failure points based on the specific context of this query.`,
      category: "LOGIC_ERROR",
      confidence: 0.55,
      rationale: `No specific error pattern matched for this query, generating a context-aware hypothesis based on the user's description.`,
    });
  }

  return fallbacks;
}

const asHypothesis = (template: Omit<Hypothesis, "status" | "evidenceIds">): Hypothesis => ({
  ...template,
  status: "untested",
  evidenceIds: [],
});

export class HypothesisEngine {
  generateCandidates(query: string, logs?: string): Hypothesis[] {
    const combined = `${query} ${logs ?? ""}`;
    const matchedHypotheses = this.matchPatterns(combined);

    let hypotheses: Hypothesis[];
    if (matchedHypotheses.length > 0) {
      hypotheses = matchedHypotheses.map(asHypothesis);
      const fallbacks = generateQueryFallbacks(query);
      hypotheses.push(...fallbacks.map(asHypothesis));
    } else {
      hypotheses = generateQueryFallbacks(query).map(asHypothesis);
    }

    return this.rankHypotheses(hypotheses);
  }

  private matchPatterns(combined: string): Array<Omit<Hypothesis, "status" | "evidenceIds">> {
    const matched: Array<Omit<Hypothesis, "status" | "evidenceIds">> = [];
    const seenIds = new Set<string>();

    for (const { patterns, hypothesis } of HYPOTHESIS_PATTERNS) {
      if (!seenIds.has(hypothesis.id) && patterns.some((pattern) => pattern.test(combined))) {
        matched.push(hypothesis);
        seenIds.add(hypothesis.id);
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
