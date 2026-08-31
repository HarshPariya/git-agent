export type AgentAction = "direct_answer" | "retrieve" | "tool";

export interface PlanRequest {
  readonly question: string;
  readonly hasConversationContext: boolean;
}

export interface AgentPlan {
  readonly action: AgentAction;
  readonly reason: string;
}



const TOOL_TERMS = new Set([
  "calculate",
  "search file",
  "read file",
  "run test",
  "execute",
]);

const containsTerm = (question: string, terms: ReadonlySet<string>): boolean =>
  [...terms].some((term) => question.toLowerCase().includes(term));

const DIRECT_ANSWER_TERMS = [
  "hi",
  "hello",
  "hey",
  "good morning",
  "good evening",
  "thanks",
  "thank you",
  "what is graphrag",
  "what is rag",
];

export const createPlan = ({ question }: PlanRequest): AgentPlan => {
  const normalizedQuestion = question.trim().toLowerCase().replace(/[!?.,]/g, "");

  if (containsTerm(normalizedQuestion, TOOL_TERMS)) {
    return {
      action: "tool",
      reason: "The question indicates that a tool may be required.",
    };
  }

  if (DIRECT_ANSWER_TERMS.some((term) => normalizedQuestion.includes(term))) {
    return {
      action: "direct_answer",
      reason: "General question or pleasantry that can be answered directly.",
    };
  }

  return {
    action: "retrieve",
    reason: "The question may require external codebase or document knowledge.",
  };
};
