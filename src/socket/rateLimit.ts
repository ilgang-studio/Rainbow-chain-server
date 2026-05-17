export interface RateLimitRule {
  intervalMs: number;
  maxHits: number;
}

export interface RateLimitState {
  timestamps: number[];
}

export type RateLimitConfig = Record<string, RateLimitRule>;

export const DEFAULT_SOCKET_RATE_LIMITS: RateLimitConfig = {
  "queue:join": { intervalMs: 10_000, maxHits: 4 },
  "queue:cancel": { intervalMs: 10_000, maxHits: 6 },
  "room:ready": { intervalMs: 10_000, maxHits: 4 },
  "rematch:request": { intervalMs: 10_000, maxHits: 6 },
  "rematch:cancel": { intervalMs: 10_000, maxHits: 6 },
  "player:move": { intervalMs: 1_000, maxHits: 120 },
  "player:state": { intervalMs: 1_000, maxHits: 120 },
  "player:away": { intervalMs: 10_000, maxHits: 6 },
  "player:back": { intervalMs: 10_000, maxHits: 6 },
  "chain:cast": { intervalMs: 5_000, maxHits: 12 },
  "chain:request": { intervalMs: 5_000, maxHits: 12 },
  "item:pickup": { intervalMs: 5_000, maxHits: 20 },
  "game:over": { intervalMs: 10_000, maxHits: 6 },
};

export function createSocketRateLimiter(config: RateLimitConfig = DEFAULT_SOCKET_RATE_LIMITS) {
  const states = new Map<string, RateLimitState>();

  function allow(eventName: string, now = Date.now()): boolean {
    const rule = config[eventName];
    if (!rule) return true;

    const state = states.get(eventName) ?? { timestamps: [] };
    const cutoff = now - rule.intervalMs;
    state.timestamps = state.timestamps.filter((timestamp) => timestamp > cutoff);

    if (state.timestamps.length >= rule.maxHits) {
      states.set(eventName, state);
      return false;
    }

    state.timestamps.push(now);
    states.set(eventName, state);
    return true;
  }

  return { allow };
}
