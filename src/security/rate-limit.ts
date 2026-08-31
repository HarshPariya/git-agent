import type { RateLimitResult, RateLimitState } from "../types/security.js";

export type { RateLimitResult, RateLimitState };

const MAX_RATE_LIMITER_ENTRIES = 50_000;

export class InMemoryRateLimiter {
  private readonly states = new Map<string, RateLimitState>();

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number,
  ) { }

  check(key: string, now = Date.now()): RateLimitResult {
    if (this.states.size >= MAX_RATE_LIMITER_ENTRIES) {
      this.cleanupExpired(now);
      if (this.states.size >= MAX_RATE_LIMITER_ENTRIES) {
        const oldest = this.states.keys().next().value;
        oldest && this.states.delete(oldest);
      }
    }

    const current = this.states.get(key);
    const isExpired = !current || now >= current.resetAt;

    if (isExpired) {
      const resetAt = now + this.windowMs;
      this.states.set(key, { count: 1, resetAt });
      return {
        allowed: true,
        remaining: this.maxRequests - 1,
        resetAt,
      };
    }

    if (current.count >= this.maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: current.resetAt,
      };
    }

    const next: RateLimitState = {
      count: current.count + 1,
      resetAt: current.resetAt,
    };

    this.states.set(key, next);

    return {
      allowed: true,
      remaining: this.maxRequests - next.count,
      resetAt: next.resetAt,
    };
  }

  reset(key?: string): void {
    key ? this.states.delete(key) : this.states.clear();
  }

  cleanupExpired(now = Date.now()): number {
    let deleted = 0;
    for (const [key, state] of this.states.entries()) {
      if (now >= state.resetAt) {
        this.states.delete(key);
        deleted++;
      }
    }
    return deleted;
  }
}
