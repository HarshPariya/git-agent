import type { AgentAction, AgentPlan, PlanRequest } from "../types/agent.js";

export type { AgentAction, AgentPlan, PlanRequest };

interface PlannerStrategy {
  readonly action: AgentAction;
  readonly reason: string;
  readonly terms: readonly string[];
}

const STRATEGIES: readonly PlannerStrategy[] = [
  {
    action: "tool",
    reason: "The question indicates that a tool may be required.",
    terms: ["calculate", "search file", "read file", "run test", "execute"],
  },
  {
    action: "retrieve",
    reason: "The question may require external knowledge.",
    terms: ["policy", "documentation", "document", "pricing", "refund", "procedure", "guideline", "company"],
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
