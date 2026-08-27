export type AgentAction = "direct_answer" | "retrieve" | "tool";

export interface PlanRequest {
  readonly question: string;
  readonly hasConversationContext: boolean;
}

export interface AgentPlan {
  readonly action: AgentAction;
  readonly reason: string;
}

const RETRIEVAL_TERMS = new Set([
  "policy",
  "documentation",
  "document",
  "pricing",
  "refund",
  "procedure",
  "guideline",
  "company",
]);

const TOOL_TERMS = new Set([
  "calculate",
  "search file",
  "read file",
  "run test",
  "execute",
]);

const containsTerm = (question: string, terms: ReadonlySet<string>): boolean =>
  [...terms].some((term) => question.toLowerCase().includes(term));

export const createPlan = ({ question }: PlanRequest): AgentPlan => {
  const normalizedQuestion = question.trim().toLowerCase();

  switch (true) {
    case containsTerm(normalizedQuestion, TOOL_TERMS):
      return {
        action: "tool",
        reason: "The question indicates that a tool may be required.",
      };

    case containsTerm(normalizedQuestion, RETRIEVAL_TERMS):
      return {
        action: "retrieve",
        reason: "The question may require external knowledge.",
      };

    default:
      return {
        action: "direct_answer",
        reason: "The question can be answered directly.",
      };
  }
};
