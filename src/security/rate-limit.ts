interface RateLimitState {
  readonly count: number;
  readonly resetAt: number;
}

export interface RateLimitResult {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly resetAt: number;
}

export class InMemoryRateLimiter {
  private readonly states = new Map<string, RateLimitState>();

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number,
  ) {}

  check(key: string, now = Date.now()): RateLimitResult {
    const current = this.states.get(key);

    if (!current || now >= current.resetAt) {
      const resetAt = now + this.windowMs;

      this.states.set(key, {
        count: 1,
        resetAt,
      });

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
}
