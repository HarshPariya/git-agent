import type { InputGuardRequest, InputGuardResult } from "../types/guardrails.js";

export type { InputGuardRequest, InputGuardResult };

const MAX_MESSAGE_LENGTH = Number(process.env.MAX_MESSAGE_LENGTH ?? 64_000);

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /reveal\s+(your\s+)?system\s+prompt/i,
  /show\s+(your\s+)?hidden\s+instructions/i,
  /disclose\s+(your\s+)?api\s+key/i,
  /bypass\s+(the\s+)?(security|guardrails?)/i,
] as const;

const isMaliciousInjection = (msg: string): boolean => {
  for (const pattern of INJECTION_PATTERNS) {
    const match = pattern.exec(msg);
    if (!match) continue;

    const precedingSlice = msg.slice(Math.max(0, match.index - 80), match.index).toLowerCase();
    const isNegated = /\b(do\s+not|don'?t|never|must\s+not|should\s+not|avoid|prohibit|prevent|without)\b/i.test(precedingSlice);
    const isSecurityEval =
      /\b(evaluat\w+|refuses?|blocks?|security\s+test|classify|deny|allow)\b/i.test(precedingSlice) ||
      (/\b(evaluat\w+|refuses?|blocks?|security\s+test)\b/i.test(msg) &&
        /^\s*[\d\.\-\*]/m.test(msg.slice(Math.max(0, match.index - 20), match.index)));

    if (!isNegated && !isSecurityEval) return true;
  }
  return false;
};

const INPUT_RULES: ReadonlyArray<(msg: string) => string | null> = [
  (msg) => (!msg ? "Message must not be empty." : null),
  (msg) => (msg.length > MAX_MESSAGE_LENGTH ? "Message exceeds the maximum allowed length." : null),
  (msg) => (isMaliciousInjection(msg) ? "Message contains a prohibited instruction pattern." : null),
];

export const validateInput = ({ message }: InputGuardRequest): InputGuardResult => {
  const normalized = message.trim();
  const failure = INPUT_RULES.map((rule) => rule(normalized)).find(Boolean);
  return failure ? { allowed: false, reason: failure } : { allowed: true };
};
