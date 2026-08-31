import type { AgentContext, AgentExecutionResult } from "../types/agent.js";

export interface CacheEntry<T> {
  readonly value: T;
  readonly expiresAt: number;
}

export interface AgentCacheConfig {
  readonly maxSize: number;
  readonly ttlMs: number;
  readonly enabled: boolean;
}

const DEFAULT_CACHE_CONFIG: AgentCacheConfig = {
  maxSize: 1000,
  ttlMs: 5 * 60 * 1000,
  enabled: true,
};

export class AgentCache {
  private readonly cache = new Map<string, CacheEntry<AgentExecutionResult>>();
  private readonly config: AgentCacheConfig;
  private hits = 0;
  private misses = 0;

  constructor(config: Partial<AgentCacheConfig> = {}) {
    this.config = { ...DEFAULT_CACHE_CONFIG, ...config };
  }

  private generateKey(context: AgentContext): string {
    return `${context.tenantId}:${context.sessionId}:${context.question}`;
  }

  get(context: AgentContext): AgentExecutionResult | null {
    if (!this.config.enabled) return null;

    const key = this.generateKey(context);
    const entry = this.cache.get(key);
    const isExpired = Boolean(entry && Date.now() > entry.expiresAt);
    isExpired && this.cache.delete(key);

    const valid = entry && !isExpired;
    valid ? this.hits++ : this.misses++;
    return valid ? entry.value : null;
  }

  set(context: AgentContext, value: AgentExecutionResult): void {
    if (!this.config.enabled) return;

    const key = this.generateKey(context);
    while (this.cache.size >= this.config.maxSize) {
      const oldest = this.cache.keys().next().value;
      if (!oldest) break;
      this.cache.delete(oldest);
    }

    this.cache.set(key, {
      value,
      expiresAt: Date.now() + this.config.ttlMs,
    });
  }

  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  getStats(): { hits: number; misses: number; hitRate: number; size: number } {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
      size: this.cache.size,
    };
  }
}

export const createAgentCache = (
  config?: Partial<AgentCacheConfig>,
): AgentCache => new AgentCache(config);

export interface RequestDeduplicationConfig {
  readonly enabled: boolean;
  readonly timeoutMs: number;
}

const DEFAULT_DEDUP_CONFIG: RequestDeduplicationConfig = {
  enabled: true,
  timeoutMs: 5000,
};

export class RequestDeduplicator {
  private readonly pending = new Map<string, Promise<AgentExecutionResult>>();
  private readonly config: RequestDeduplicationConfig;

  constructor(config: Partial<RequestDeduplicationConfig> = {}) {
    this.config = { ...DEFAULT_DEDUP_CONFIG, ...config };
  }

  private generateKey(context: AgentContext): string {
    return `${context.tenantId}:${context.sessionId}:${context.question}`;
  }

  async execute<T>(
    context: AgentContext,
    operation: () => Promise<T>,
  ): Promise<T> {
    if (!this.config.enabled) return operation();

    const key = this.generateKey(context);
    const existing = this.pending.get(key);
    if (existing) return existing as Promise<T>;

    let timer: NodeJS.Timeout | undefined;
    try {
      const promise = operation();
      this.pending.set(key, promise as Promise<AgentExecutionResult>);
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Deduplication timeout")),
          this.config.timeoutMs,
        );
      });
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      timer && clearTimeout(timer);
      this.pending.delete(key);
    }
  }

  getPendingCount(): number {
    return this.pending.size;
  }
}

export const createRequestDeduplicator = (
  config?: Partial<RequestDeduplicationConfig>,
): RequestDeduplicator => new RequestDeduplicator(config);
