import type { InsightCategory, UserMemoryStore } from "./user-memory.js";

interface ExtractionRule {
  readonly pattern: RegExp;
  readonly category: InsightCategory;
  readonly topic: string;
  readonly extract: (match: RegExpMatchArray, message: string) => string;
}

const EXTRACTION_RULES: readonly ExtractionRule[] = [
  {
    pattern: /(?:always|prefer|use)\s+(typescript|javascript|python|go|rust)\b/i,
    category: "preference",
    topic: "programming_language",
    extract: (match) => `Prefers ${match[1] ?? ""} for code implementations.`,
  },
  {
    pattern: /(?:always\s+use|prefer)\s+(snake_case|camelCase|PascalCase|kebab-case)\b/i,
    category: "guideline",
    topic: "naming_convention",
    extract: (match) => `Follow ${match[1] ?? ""} naming convention.`,
  },
  {
    pattern: /(?:prefer|always\s+use)\s+(async\/await|promises|callbacks)\b/i,
    category: "preference",
    topic: "async_pattern",
    extract: (match) => `Prefers ${match[1] ?? ""} for asynchronous code.`,
  },
  {
    pattern: /(?:keep|make)\s+(?:answers|responses|explanations)\s+(concise|short|detailed|brief)\b/i,
    category: "preference",
    topic: "response_style",
    extract: (match) => `Wants responses to be ${(match[1] ?? "").toLowerCase()}.`,
  },
  {
    pattern: /(?:our|my)\s+(?:project|app|codebase)\s+uses?\s+([a-z0-9_\-\s]{3,30})/i,
    category: "fact",
    topic: "tech_stack",
    extract: (match) => `Project uses ${(match[1] ?? "").trim()}.`,
  },
  {
    pattern: /(?:remember|note|always|never)\s+that\s+([^.!?\n]{5,100})/i,
    category: "guideline",
    topic: "user_rule",
    extract: (match) => (match[1] ?? "").trim(),
  },
];

export async function extractUserInsights(
  tenantId: string,
  userId: string,
  message: string,
  memoryStore: UserMemoryStore,
): Promise<number> {
  if (!message || message.trim().length < 5) {
    return 0;
  }

  let extractedCount = 0;

  for (const rule of EXTRACTION_RULES) {
    const match = message.match(rule.pattern);
    if (match) {
      const insight = rule.extract(match, message);
      await memoryStore.addInsight(tenantId, userId, {
        category: rule.category,
        topic: rule.topic,
        insight,
        confidence: 0.95,
      });
      extractedCount++;
    }
  }

  return extractedCount;
}
