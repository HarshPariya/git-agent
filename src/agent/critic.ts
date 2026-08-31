import type { CriticRequest, CriticResult } from "../types/agent.js";

export type { CriticRequest, CriticResult };

const normalize = (value: string): readonly string[] =>
  value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2);

const getNumbers = (value: string): readonly string[] =>
  value.match(/\b\d+(?:\.\d+)?\b/g) ?? [];

const hasConflictingNumbers = (answer: string, context: string): boolean => {
  const answerNumbers = new Set(getNumbers(answer));
  const contextNumbers = new Set(getNumbers(context));
  return (
    answerNumbers.size > 0 &&
    contextNumbers.size > 0 &&
    [...answerNumbers].some((number) => !contextNumbers.has(number))
  );
};

const getOverlap = (
  answerTokens: readonly string[],
  contextTokens: ReadonlySet<string>,
): number => answerTokens.filter((token) => contextTokens.has(token)).length;

type ValidationRule = (ctx: {
  normalizedAnswer: string;
  normalizedContext: string;
  questionTokens: readonly string[];
  answerTokens: readonly string[];
  contextTokens: Set<string>;
}) => CriticResult | null;

const CRITIC_RULES: readonly ValidationRule[] = [
  ({ normalizedAnswer }) =>
    !normalizedAnswer
      ? { passed: false, reason: "The answer is empty." }
      : null,
  ({ normalizedContext }) =>
    !normalizedContext
      ? { passed: false, reason: "No supporting context was provided." }
      : null,
  ({ normalizedAnswer, normalizedContext }) =>
    hasConflictingNumbers(normalizedAnswer, normalizedContext)
      ? {
        passed: false,
        reason:
          "The answer contains numeric claims that conflict with the provided context.",
      }
      : null,
  ({ questionTokens, answerTokens }) =>
    getOverlap(questionTokens, new Set(answerTokens)) === 0
      ? { passed: false, reason: "The answer does not address the question." }
      : null,
  ({ answerTokens, contextTokens }) =>
    getOverlap(answerTokens, contextTokens) === 0
      ? {
        passed: false,
        reason:
          "The answer does not contain information supported by the provided context.",
      }
      : null,
];

export const evaluateAnswer = ({
  question,
  answer,
  context,
}: CriticRequest): CriticResult => {
  const normalizedAnswer = answer.trim();
  const normalizedContext = context.trim();
  const state = {
    normalizedAnswer,
    normalizedContext,
    questionTokens: normalize(question),
    answerTokens: normalize(normalizedAnswer),
    contextTokens: new Set(normalize(normalizedContext)),
  };

  const failure = CRITIC_RULES.map((rule) => rule(state)).find(Boolean);
  return (
    failure ?? {
      passed: true,
      reason:
        "The answer contains information supported by the provided context.",
    }
  );
};
