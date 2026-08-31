import type {
  InputGuardRequest,
  InputGuardResult,
} from "../types/guardrails.js";

export type { InputGuardRequest, InputGuardResult };

const DEFAULT_MAX_MESSAGE_LENGTH = 4_000;
const MAX_MESSAGE_LENGTH = Number(
  process.env.MAX_MESSAGE_LENGTH ?? DEFAULT_MAX_MESSAGE_LENGTH,
);

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /reveal\s+(your\s+)?system\s+prompt/i,
  /show\s+(your\s+)?hidden\s+instructions/i,
  /disclose\s+(your\s+)?api\s+key/i,
  /bypass\s+(the\s+)?(security|guardrails?)/i,
] as const;

type InputRule = (msg: string) => string | null;

const INPUT_RULES: readonly InputRule[] = [
  (msg) => (!msg ? "Message must not be empty." : null),
  (msg) =>
    msg.length > MAX_MESSAGE_LENGTH
      ? "Message exceeds the maximum allowed length."
      : null,
  (msg) =>
    INJECTION_PATTERNS.some((pattern) => pattern.test(msg))
      ? "Message contains a prohibited instruction pattern."
      : null,
];

export const validateInput = ({
  message,
}: InputGuardRequest): InputGuardResult => {
  const normalized = message.trim();
  const failure = INPUT_RULES.map((rule) => rule(normalized)).find(Boolean);
  return failure ? { allowed: false, reason: failure } : { allowed: true };
};
