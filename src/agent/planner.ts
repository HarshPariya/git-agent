import type { AgentAction, AgentPlan, PlanRequest } from "../types/agent.js";

export type { AgentAction, AgentPlan, PlanRequest };

interface PlannerStrategy {
  readonly action: AgentAction;
  readonly reason: string;
  readonly terms: readonly string[];
}

const STRATEGIES: readonly PlannerStrategy[] = [
  {
    action: "retrieve",
    reason: "The question may require external knowledge.",
    terms: [
      "policy",
      "pricing",
      "refund",
      "procedure",
      "guideline",
      "company",
    ],
  },
  {
    action: "tool",
    reason: "The question indicates that a tool may be required.",
    terms: [
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
      "agent folder",
      "src folder",
      "git",
      "list files",
      "show files",
      "check my folder",
      "check folder",
      "check files",
      "what is in",
      "inspect",
      "architecture.md",
      "demo.md",
      "package.json",
      "tsconfig",
    ],
  },
];

export const createPlan = ({ question }: PlanRequest): AgentPlan => {
  const normalized = question.trim().toLowerCase();
  const matched = STRATEGIES.find((strategy) =>
    strategy.terms.some((term) => normalized.includes(term)),
  );

  return matched
    ? { action: matched.action, reason: matched.reason }
    : { action: "direct_answer", reason: "The question can be answered directly." };
};
