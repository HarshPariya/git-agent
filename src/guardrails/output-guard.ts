import type { OutputGuardRequest, OutputGuardResult } from "../types/guardrails.js";

export type { OutputGuardRequest, OutputGuardResult };

const MAX_RESPONSE_LENGTH = Number(process.env.MAX_RESPONSE_LENGTH ?? 64_000);

const SENSITIVE_PATTERNS = [
  /api[_\s-]?key\s*[:=]\s*\S+/i,
  /api[_\s-]?key\s+is\s+\S+/i,
  /secret\s*[:=]\s*\S+/i,
  /secret\s+is\s+\S+/i,
  /password\s*[:=]\s*\S+/i,
  /password\s+is\s+\S+/i,
  /(?:here\s+is|revealing|leaked|dumped|my)\s+(?:the\s+)?system\s+prompt/i,
  /(?:here\s+are|revealing|leaked|dumped|my)\s+(?:the\s+)?internal\s+instructions/i,
  /system\s+prompt\s*:\s*\.\.\./i,
  /system\s+prompt\s*[:=]\s*(?:you\s+are|instructions)/i,
] as const;

const containsSensitiveData = (response: string): boolean =>
  SENSITIVE_PATTERNS.some((pattern) => pattern.test(response));

const OUTPUT_RULES: ReadonlyArray<(res: string) => string | null> = [
  (res) => (!res ? "The generated response is empty." : null),
  (res) => (res.length > MAX_RESPONSE_LENGTH ? "The generated response exceeds the maximum allowed length." : null),
  (res) => (containsSensitiveData(res) ? "The generated response contains restricted information." : null),
];

export const validateOutput = ({ response }: OutputGuardRequest): OutputGuardResult => {
  const normalized = response.trim();
  const failure = OUTPUT_RULES.map((rule) => rule(normalized)).find(Boolean);
  return failure ? { allowed: false, reason: failure } : { allowed: true, response: normalized };
};
