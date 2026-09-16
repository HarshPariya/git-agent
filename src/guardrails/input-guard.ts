import type { InputGuardRequest, InputGuardResult } from "../types/guardrails.js";

export type { InputGuardRequest, InputGuardResult };

const MAX_MESSAGE_LENGTH = Number(process.env.MAX_MESSAGE_LENGTH ?? 64_000);
const NEGATION_CONTEXT_LENGTH = 80;

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /reveal\s+(your\s+)?system\s+prompt/i,
  /show\s+(your\s+)?hidden\s+instructions/i,
  /disclose\s+(your\s+)?api\s+key/i,
  /bypass\s+(the\s+)?(security|guardrails?)/i,
];

// matchAll requires global regexes; create global copies from the base patterns
const INJECTION_PATTERNS_GLOBAL = INJECTION_PATTERNS.map((p) => new RegExp(p.source, "gi"));

const NEGATION_PATTERN = /\b(do\s+not|don'?t|never|must\s+not|should\s+not|avoid|prohibit|prevent|without)\b/i;
const SECURITY_EVAL_PATTERN = /\b(evaluat\w+|refuses?|blocks?|security\s+test|classify|deny|allow)\b/i;
const BULLET_LIST_PATTERN = /^\s*[\d.\-*]/m;

const isNegatedContext = (msg: string, matchIndex: number): boolean => {
  const precedingSlice = msg.slice(Math.max(0, matchIndex - NEGATION_CONTEXT_LENGTH), matchIndex).toLowerCase();
  return NEGATION_PATTERN.test(precedingSlice);
};

const isSecurityEvaluation = (msg: string, _matchIndex: number): boolean => {
  return SECURITY_EVAL_PATTERN.test(msg) && BULLET_LIST_PATTERN.test(msg);
};

const isMaliciousInjection = (msg: string): boolean =>
  INJECTION_PATTERNS_GLOBAL.some((pattern) => {
    const matches = [...msg.matchAll(pattern)];
    return matches.some((match) => {
      const idx = match.index;
      return idx !== undefined && !isNegatedContext(msg, idx) && !isSecurityEvaluation(msg, idx);
    });
  });

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
