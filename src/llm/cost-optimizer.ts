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

export class LlmCostOptimizer {
  private readonly config: LlmCostConfig;
  private readonly cache = new Map<
    string,
    { response: string; tokens: TokenUsage; expiresAt: number }
  >();
  private readonly metrics: MutableCostMetrics = {
    totalTokens: 0,
    totalRequests: 0,
    totalCostUsd: 0,
    cacheHits: 0,
    cacheMisses: 0,
    avgTokensPerRequest: 0,
  };
  private readonly tokenCounts: number[] = [];
  private readonly minuteWindow: { count: number; resetAt: number } = {
    count: 0,
    resetAt: Date.now() + 60000,
  };

  constructor(config: Partial<LlmCostConfig> = {}) {
    this.config = { ...DEFAULT_COST_CONFIG, ...config };
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  private generateCacheKey(instructions: string, input: string): string {
    const combined = `${instructions}|${input}`;
    let hash = 0;
    for (let i = 0; i < combined.length; i++) {
      const char = combined.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0;
    }
    return `${hash}`;
  }

  checkRateLimit(): { allowed: boolean; retryAfterMs?: number } {
    const now = Date.now();
    if (now >= this.minuteWindow.resetAt) {
      this.minuteWindow.count = 0;
      this.minuteWindow.resetAt = now + 60000;
    }

    const exceeded = this.minuteWindow.count >= this.config.maxTokensPerMinute;
    return exceeded
      ? { allowed: false, retryAfterMs: this.minuteWindow.resetAt - now }
      : { allowed: true };
  }

  getCachedResponse(
    instructions: string,
    input: string,
  ): { text: string; tokens: TokenUsage } | null {
    if (!this.config.enableCaching) return null;

    const key = this.generateCacheKey(instructions, input);
    const entry = this.cache.get(key);
    const isExpired = Boolean(entry && Date.now() > entry.expiresAt);
    isExpired && this.cache.delete(key);

    const valid = entry && !isExpired;
    valid ? this.metrics.cacheHits++ : this.metrics.cacheMisses++;
    return valid ? { text: entry.response, tokens: entry.tokens } : null;
  }

  cacheResponse(
    instructions: string,
    input: string,
    response: string,
    tokens: TokenUsage,
  ): void {
    if (!this.config.enableCaching) return;

    const key = this.generateCacheKey(instructions, input);
    while (this.cache.size >= 10000) {
      const oldest = this.cache.keys().next().value;
      if (!oldest) break;
      this.cache.delete(oldest);
    }

    this.cache.set(key, {
      response,
      tokens,
      expiresAt: Date.now() + this.config.cacheTtlMs,
    });
  }

  recordUsage(tokens: TokenUsage): void {
    this.metrics.totalTokens += tokens.totalTokens;
    this.metrics.totalRequests++;
    this.tokenCounts.push(tokens.totalTokens);
    if (this.tokenCounts.length > 1000) this.tokenCounts.shift();

    this.metrics.avgTokensPerRequest =
      this.metrics.totalTokens / this.metrics.totalRequests;
    this.minuteWindow.count += tokens.totalTokens;

    const costPer1k = this.config.costPer1kTokens ?? 0.002;
    this.metrics.totalCostUsd += (tokens.totalTokens / 1000) * costPer1k;
  }

  getMetrics(): CostMetrics {
    return { ...this.metrics };
  }

  truncateContext(context: string, maxTokens: number): string {
    const estimated = this.estimateTokens(context);
    if (estimated <= maxTokens) return context;

    const ratio = maxTokens / estimated;
    const truncatedLength = Math.floor(context.length * ratio * 0.9);
    return `${context.slice(0, truncatedLength)}...`;
  }

  summarizeIfNeeded(context: string): string {
    return this.config.summarizeLongContext &&
      this.estimateTokens(context) > this.config.maxContextLength
      ? this.truncateContext(context, this.config.maxContextLength)
      : context;
  }

  resetMetrics(): void {
    this.metrics.totalTokens = 0;
    this.metrics.totalRequests = 0;
    this.metrics.totalCostUsd = 0;
    this.metrics.cacheHits = 0;
    this.metrics.cacheMisses = 0;
    this.metrics.avgTokensPerRequest = 0;
    this.tokenCounts.length = 0;
  }
}

export const createLlmCostOptimizer = (
  config?: Partial<LlmCostConfig>,
): LlmCostOptimizer => new LlmCostOptimizer(config);
