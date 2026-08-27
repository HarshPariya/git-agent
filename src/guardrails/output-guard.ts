export interface OutputGuardRequest {
  readonly response: string;
}

export interface OutputGuardResult {
  readonly allowed: boolean;
  readonly response?: string;
  readonly reason?: string;
}

const MAX_RESPONSE_LENGTH = 8_000;

const SENSITIVE_PATTERNS = [
  /api[_\s-]?key\s*[:=]\s*\S+/i,
  /secret\s*[:=]\s*\S+/i,
  /password\s*[:=]\s*\S+/i,
  /system prompt/i,
  /internal instructions/i,
] as const;

const containsSensitiveContent = (response: string): boolean =>
  SENSITIVE_PATTERNS.some((pattern) => pattern.test(response));

export const validateOutput = ({
  response,
}: OutputGuardRequest): OutputGuardResult => {
  const normalizedResponse = response.trim();

  switch (normalizedResponse.length) {
    case 0:
      return {
        allowed: false,
        reason: "The generated response is empty.",
      };

    default:
      break;
  }

  switch (normalizedResponse.length > MAX_RESPONSE_LENGTH) {
    case true:
      return {
        allowed: false,
        reason: "The generated response exceeds the maximum allowed length.",
      };

    default:
      break;
  }

  switch (containsSensitiveContent(normalizedResponse)) {
    case true:
      return {
        allowed: false,
        reason: "The generated response contains restricted information.",
      };

    default:
      return {
        allowed: true,
        response: normalizedResponse,
      };
  }
};
