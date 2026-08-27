export interface InputGuardRequest {
  readonly message: string;
}

export interface InputGuardResult {
  readonly allowed: boolean;
  readonly reason?: string;
}

const MAX_MESSAGE_LENGTH = 4_000;

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /reveal\s+(your\s+)?system\s+prompt/i,
  /show\s+(your\s+)?hidden\s+instructions/i,
  /disclose\s+(your\s+)?api\s+key/i,
  /bypass\s+(the\s+)?(security|guardrails?)/i,
] as const;

const matchesInjectionPattern = (message: string): boolean =>
  INJECTION_PATTERNS.some((pattern) => pattern.test(message));

export const validateInput = ({
  message,
}: InputGuardRequest): InputGuardResult => {
  const normalizedMessage = message.trim();

  switch (normalizedMessage.length) {
    case 0:
      return {
        allowed: false,
        reason: "Message must not be empty.",
      };

    default:
      break;
  }

  switch (normalizedMessage.length > MAX_MESSAGE_LENGTH) {
    case true:
      return {
        allowed: false,
        reason: "Message exceeds the maximum allowed length.",
      };

    default:
      break;
  }

  switch (matchesInjectionPattern(normalizedMessage)) {
    case true:
      return {
        allowed: false,
        reason: "Message contains a prohibited instruction pattern.",
      };

    default:
      return {
        allowed: true,
      };
  }
};
