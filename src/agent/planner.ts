import type { AgentAction, AgentPlan, PlanRequest } from "../types/agent.js";

export type { AgentAction, AgentPlan, PlanRequest };

/**
 * HYBRID ROUTING ARCHITECTURE
 *
 * Tier 1 — High-confidence deterministic routing for security and operations:
 *   1. REFUSE:   Security-sensitive, destructive, or prohibited operations.
 *   2. RETRIEVE: Knowledge-domain questions (policies, pricing, SLA, etc.).
 *   3. TOOL:     Explicit file, directory, git, calculation, or multi-tool operations.
 *
 * Tier 2 — Semantic fallthrough:
 *   - General conversation and knowledge queries route to DIRECT_ANSWER.
 */

interface PlannerRule {
  readonly action: AgentAction;
  readonly reason: string;
  readonly matcher: (q: string) => boolean;
}

// ──────────────────────────────────────────────────────────────
// REFUSE PATTERNS — Prohibited / destructive / credential access
// ──────────────────────────────────────────────────────────────
const REFUSE_PATTERNS: readonly RegExp[] = [
  // Credential / secret extraction attempts
  /\b(?:reveal|show|disclose|give|print|dump|expose)\s+(?:me\s+)?(?:your\s+|the\s+)?(?:api\s+key|credentials|secrets?|tokens?|passwords?)\b/i,
  /\b(?:reveal|show|disclose)\s+(?:your\s+|the\s+)?(?:system\s+prompt|hidden\s+instructions|internal\s+instructions)\b/i,
  /\bwhat\s+is\s+(?:your|the)\s+(?:api\s+key|secret|token|password)\b/i,
  /\b(?:print|dump|expose)\s+(?:the\s+|your\s+)?(?:env\s+vars?|secrets?|credentials)\b/i,

  // Direct .env inspection / reading
  /\b(?:read|open|show|cat|inspect|display|view)\s+\.env\b/i,

  // Destructive repo/workspace nuking
  /\b(?:delete|remove|destroy|wipe|nuke)\s+(?:the\s+)?(?:entire\s+)?(?:repo|repository|project|workspace|codebase)\b/i,
  /rm\s+(-rf?|-r\s+-f)\s+\./i,
  /\b(?:delete|remove)\s+(?:all\s+)?(?:files|everything|the\s+repo)\b/i,

  // Prompt injection & jailbreaks
  /ignore\s+(?:all\s+)?previous\s+instructions/i,
  /bypass\s+(?:the\s+)?(?:security|guardrails?|restrictions?|safety)/i,
  /act\s+as\s+(?:if|though)\s+(?:you\s+have\s+no|without)\s+(?:restrictions?|guardrails?|safety)/i,
  /pretend\s+(?:you\s+are|to\s+be)\s+(?:an?\s+)?(?:unrestricted|jailbroken|evil)/i,

  // Cross-tenant private data access
  /access\s+(?:another|other|different)\s+tenant/i,
  /get\s+(?:another|other|different)\s+tenant'?s?\s+(?:data|files|information)/i,
  /switch\s+to\s+another\s+tenant/i,
];

// ──────────────────────────────────────────────────────────────
// RETRIEVE PATTERNS — Explicit knowledge / documentation domain
// ──────────────────────────────────────────────────────────────
const RETRIEVE_TERMS: readonly string[] = [
  "refund policy",
  "refund policies",
  "return policy",
  "what is the policy",
  "pricing policy",
  "pricing plan",
  "product pricing",
  "product a pricing",
  "product b pricing",
  "product c pricing",
  "about product a pricing",
  "about its pricing",
  "its pricing",
  "company policy",
  "company guideline",
  "knowledge base",
  "documentation on",
  "official policy",
  "your policy",
  "sla policy",
  "terms of service",
  "terms and conditions",
  "support policy",
  "cancellation policy",
];

// ──────────────────────────────────────────────────────────────
// TOOL PATTERNS — Explicit operations on workspace, git, or files
// ──────────────────────────────────────────────────────────────

/** Explicit file paths (e.g. 'src/agent/planner.ts', 'scratch/agent-ui-test.txt') */
const FILE_PATH_REGEX =
  /(?:^|[\s'"`(])(?:\.{1,2}[/\\]|(?:[a-zA-Z0-9_-]+[/\\])+)[a-zA-Z0-9_\-./\\]+\.[a-zA-Z0-9]{1,6}(?=$|[\s'"`),])/m;

/** Explicit filenames (e.g. planner.ts, README.md, package.json) */
const FILENAME_REGEX =
  /\b[a-zA-Z0-9_-]{2,}\.(?:ts|js|json|md|txt|yml|yaml|html|css|toml|sh|py|go|rs|rb|gitignore|dockerfile)\b/i;

/** Git operations */
const GIT_REGEX =
  /\b(?:git\s+(?:status|log|diff|branch|commit|push|pull|fetch|stash)|(?:check|show|get|what(?:'s|\s+is))\s+(?:the\s+)?(?:current\s+)?(?:git\s+status|git\s+branch|branch|commit\s+history|diff|changes))\b/i;

/** Workspace / folder inspection */
const WORKSPACE_REGEX =
  /\b(?:folder\s+structure|directory\s+structure|file\s+structure|file\s+tree|workspace|project\s+files|codebase\s+structure|everything\s+directly\s+inside)\b/i;

/** Tool action verbs (calculate, create, edit, delete, inspect, list, verify) */
const TOOL_ACTION_REGEX =
  /\b(?:calculate|compute|create|write|make|generate|edit|modify|update|change|replace|delete|remove|read|inspect|cat|open|view|display|list|ls|verify|search\s+for\s+refund\s+policy)\b/i;

const DETERMINISTIC_RULES: readonly PlannerRule[] = [
  // 1. Refuse (security-critical — evaluated first)
  {
    action: "refuse",
    reason:
      "The request is prohibited: it attempts a dangerous, destructive, or security-violating operation.",
    matcher: (q) => REFUSE_PATTERNS.some((pattern) => pattern.test(q)),
  },

  // 2. Retrieve (knowledge domain — evaluated before general tool verbs)
  {
    action: "retrieve",
    reason:
      "The request asks about company knowledge, domain policies, or product-specific documentation.",
    matcher: (q) => RETRIEVE_TERMS.some((term) => q.includes(term)),
  },

  // 3. Tool (high-confidence explicit operational signals)
  {
    action: "tool",
    reason:
      "The request explicitly requires workspace inspection, file operations, git commands, calculations, or multi-tool tasks.",
    matcher: (q) =>
      FILE_PATH_REGEX.test(q) ||
      FILENAME_REGEX.test(q) ||
      GIT_REGEX.test(q) ||
      WORKSPACE_REGEX.test(q) ||
      TOOL_ACTION_REGEX.test(q),
  },
];

/**
 * createPlan — Hybrid intent router.
 *
 * Deterministic rules evaluate fast for safety, knowledge queries, and explicit tool commands.
 * Falls through to direct_answer for general conversational requests.
 */
export const createPlan = ({ question }: PlanRequest): AgentPlan => {
  const normalized = question.trim().toLowerCase();
  const matched = DETERMINISTIC_RULES.find((rule) => rule.matcher(normalized));

  return matched
    ? { action: matched.action, reason: matched.reason }
    : {
      action: "direct_answer",
      reason:
        "The request will be answered directly from conversational knowledge.",
    };
};
