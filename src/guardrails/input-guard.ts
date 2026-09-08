import type { InputGuardRequest, InputGuardResult } from "../types/guardrails.js";

export type { InputGuardRequest, InputGuardResult };

const MAX_MESSAGE_LENGTH = Number(process.env.MAX_MESSAGE_LENGTH ?? 64_000);
const NEGATION_CONTEXT_LENGTH = 80;
const SECURITY_EVAL_OFFSET = 20;

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /reveal\s+(your\s+)?system\s+prompt/i,
  /show\s+(your\s+)?hidden\s+instructions/i,
  /disclose\s+(your\s+)?api\s+key/i,
  /bypass\s+(the\s+)?(security|guardrails?)/i,
] as const;

const NEGATION_PATTERN = /\b(do\s+not|don'?t|never|must\s+not|should\s+not|avoid|prohibit|prevent|without)\b/i;
const SECURITY_EVAL_PATTERN = /\b(evaluat\w+|refuses?|blocks?|security\s+test|classify|deny|allow)\b/i;
const BULLET_LIST_PATTERN = /^\s*[\d\.\-\*]/m;

const isNegatedContext = (msg: string, matchIndex: number): boolean => {
  const precedingSlice = msg.slice(Math.max(0, matchIndex - NEGATION_CONTEXT_LENGTH), matchIndex).toLowerCase();
  return NEGATION_PATTERN.test(precedingSlice);
};

const isSecurityEvaluation = (msg: string, matchIndex: number): boolean => {
  const precedingSlice = msg.slice(Math.max(0, matchIndex - NEGATION_CONTEXT_LENGTH), matchIndex).toLowerCase();
  const inPreceding = SECURITY_EVAL_PATTERN.test(precedingSlice);
  const inMessage = SECURITY_EVAL_PATTERN.test(msg);
  const hasBullets = BULLET_LIST_PATTERN.test(msg.slice(Math.max(0, matchIndex - SECURITY_EVAL_OFFSET), matchIndex));
  return inPreceding || (inMessage && hasBullets);
};

const isMaliciousInjection = (msg: string): boolean =>
  INJECTION_PATTERNS.some((pattern) => {
    const match = pattern.exec(msg);
    if (!match?.index) return false;
    return !isNegatedContext(msg, match.index) && !isSecurityEvaluation(msg, match.index);
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
