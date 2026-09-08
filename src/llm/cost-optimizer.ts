import type {
  CostMetrics,
  LlmCostConfig,
  TokenUsage,
} from "../types/llm.js";

export type { CostMetrics, LlmCostConfig, TokenUsage };

const DEFAULT_COST_CONFIG: LlmCostConfig = {
  maxTokensPerRequest: 4096,
  maxTokensPerMinute: 60000,
  enableCaching: true,
  cacheTtlMs: 10 * 60 * 1000,
  summarizeLongContext: true,
  maxContextLength: 8192,
  costPer1kTokens: 0.002,
};

interface MutableCostMetrics {
  totalTokens: number;
  totalRequests: number;
  totalCostUsd: number;
  cacheHits: number;
  cacheMisses: number;
  avgTokensPerRequest: number;
}

const ZERO_METRICS: MutableCostMetrics = {
  totalTokens: 0,
  totalRequests: 0,
  totalCostUsd: 0,
  cacheHits: 0,
  cacheMisses: 0,
  avgTokensPerRequest: 0,
};

const computeHash = (input: string): number => {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return hash;
};

export class LlmCostOptimizer {
  private readonly config: LlmCostConfig;
  private readonly cache = new Map<string, { response: string; tokens: TokenUsage; expiresAt: number }>();
  private readonly metrics: MutableCostMetrics = { ...ZERO_METRICS };
  private readonly tokenCounts: number[] = [];
  private readonly minuteWindow = { count: 0, resetAt: Date.now() + 60_000 };

  constructor(config: Partial<LlmCostConfig> = {}) {
    this.config = { ...DEFAULT_COST_CONFIG, ...config };
  }

  private estimateTokens = (text: string): number => Math.ceil(text.length / 4);

  private generateCacheKey = (instructions: string, input: string): string =>
    `${computeHash(`${instructions}|${input}`)}`;

  checkRateLimit(): { allowed: boolean; retryAfterMs?: number } {
    const now = Date.now();
    if (now >= this.minuteWindow.resetAt) {
      this.minuteWindow.count = 0;
      this.minuteWindow.resetAt = now + 60_000;
    }

    return this.minuteWindow.count >= this.config.maxTokensPerMinute
      ? { allowed: false, retryAfterMs: this.minuteWindow.resetAt - now }
      : { allowed: true };
  }

  getCachedResponse(instructions: string, input: string): { text: string; tokens: TokenUsage } | null {
    if (!this.config.enableCaching) return null;

    const key = this.generateCacheKey(instructions, input);
    const entry = this.cache.get(key);
    if (!entry) { this.metrics.cacheMisses++; return null; }

    const expired = Date.now() > entry.expiresAt;
    if (expired) { this.cache.delete(key); this.metrics.cacheMisses++; return null; }

    this.metrics.cacheHits++;
    return { text: entry.response, tokens: entry.tokens };
  }

  cacheResponse(instructions: string, input: string, response: string, tokens: TokenUsage): void {
    if (!this.config.enableCaching) return;

    while (this.cache.size >= 10_000) {
      const oldest = this.cache.keys().next().value;
      if (!oldest) break;
      this.cache.delete(oldest);
    }

    this.cache.set(this.generateCacheKey(instructions, input), {
      response,
      tokens,
      expiresAt: Date.now() + this.config.cacheTtlMs,
    });
  }

  recordUsage(tokens: TokenUsage): void {
    const { totalTokens } = tokens;
    this.metrics.totalTokens += totalTokens;
    this.metrics.totalRequests++;
    this.metrics.avgTokensPerRequest = this.metrics.totalTokens / this.metrics.totalRequests;
    this.minuteWindow.count += totalTokens;

    this.tokenCounts.push(totalTokens);
    if (this.tokenCounts.length > 1000) this.tokenCounts.shift();

    this.metrics.totalCostUsd += (totalTokens / 1000) * (this.config.costPer1kTokens ?? 0.002);
  }

  getMetrics(): CostMetrics {
    return { ...this.metrics };
  }

  truncateContext(context: string, maxTokens: number): string {
    const estimated = this.estimateTokens(context);
    if (estimated <= maxTokens) return context;

    const truncatedLength = Math.floor(context.length * (maxTokens / estimated) * 0.9);
    return `${context.slice(0, truncatedLength)}...`;
  }

  summarizeIfNeeded(context: string): string {
    const { summarizeLongContext, maxContextLength } = this.config;
    return summarizeLongContext && this.estimateTokens(context) > maxContextLength
      ? this.truncateContext(context, maxContextLength)
      : context;
  }

  resetMetrics(): void {
    Object.assign(this.metrics, { ...ZERO_METRICS });
    this.tokenCounts.length = 0;
  }
}

export const createLlmCostOptimizer = (config?: Partial<LlmCostConfig>): LlmCostOptimizer =>
  new LlmCostOptimizer(config);
