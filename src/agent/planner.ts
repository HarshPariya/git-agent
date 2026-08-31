import type { AgentAction, AgentPlan, PlanRequest } from "../types/agent.js";

export type { AgentAction, AgentPlan, PlanRequest };

interface PlannerRule {
  readonly action: AgentAction;
  readonly reason: string;
  readonly matcher: (q: string) => boolean;
}

const TOOL_TERMS = [
  "calculate",
  "search file",
  "search code",
  "read file",
  "write file",
  "create file",
  "delete file",
  "remove file",
  "edit file",
  "modify file",
  "update file",
  "save file",
  "generate file",
  "write code",
  "code in",
  "write in",
  "create",
  "delete",
  "remove",
  "modify",
  "replace",
  "update",
  "change",
  "edit",
  "read",
  "write",
  "run test",
  "execute",
  "folder",
  "directory",
  "file structure",
  "folder structure",
  "files in",
  "git",
  "list files",
  "show files",
  "check my folder",
  "check folder",
  "check files",
  "what is in",
  "inspect",
] as const;

const RETRIEVE_TERMS = [
  "policy",
  "pricing",
  "refund",
  "procedure",
  "guideline",
  "company",
  "documentation on",
  "knowledge base",
] as const;

const FILE_PATH_REGEX = /(?:\.[\/\\]|[a-zA-Z0-9_-]+[\/\\])[a-zA-Z0-9_\-\.\/]+\.[a-zA-Z0-9]+/i;

const RULES: readonly PlannerRule[] = [
  {
    action: "tool",
    reason: "The question requires file system, git, or autonomous workspace tools.",
    matcher: (q) =>
      TOOL_TERMS.some((term) => q.includes(term)) || FILE_PATH_REGEX.test(q),
  },
  {
    action: "retrieve",
    reason: "The question may require external knowledge retrieval.",
    matcher: (q) => RETRIEVE_TERMS.some((term) => q.includes(term)),
  },
];

export const createPlan = ({ question }: PlanRequest): AgentPlan => {
  const normalized = question.trim().toLowerCase();
  const matched = RULES.find((rule) => rule.matcher(normalized));

  return matched
    ? { action: matched.action, reason: matched.reason }
    : { action: "direct_answer", reason: "The question can be answered directly." };
};
