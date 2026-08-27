export interface CriticRequest {
  readonly question: string;
  readonly answer: string;
  readonly context: string;
}

export interface CriticResult {
  readonly passed: boolean;
  readonly reason: string;
}

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

export const evaluateAnswer = ({
  question,
  answer,
  context,
}: CriticRequest): CriticResult => {
  const normalizedAnswer = answer.trim();
  const normalizedContext = context.trim();
  const questionTokens = normalize(question);
  const answerTokens = normalize(normalizedAnswer);
  const contextTokens = new Set(normalize(normalizedContext));

  switch (normalizedAnswer.length) {
    case 0:
      return {
        passed: false,
        reason: "The answer is empty.",
      };

    default:
      break;
  }

  switch (normalizedContext.length) {
    case 0:
      return {
        passed: false,
        reason: "No supporting context was provided.",
      };

    default:
      break;
  }

  switch (hasConflictingNumbers(normalizedAnswer, normalizedContext)) {
    case true:
      return {
        passed: false,
        reason:
          "The answer contains numeric claims that conflict with the provided context.",
      };

    default:
      break;
  }

  switch (getOverlap(questionTokens, new Set(answerTokens))) {
    case 0:
      return {
        passed: false,
        reason: "The answer does not address the question.",
      };

    default:
      break;
  }

  switch (getOverlap(answerTokens, contextTokens) > 0) {
    case true:
      return {
        passed: true,
        reason:
          "The answer contains information supported by the provided context.",
      };

    default:
      return {
        passed: false,
        reason:
          "The answer does not contain information supported by the provided context.",
      };
  }
};
