import "server-only";

export interface RateLimit {
  /** True = reject. */
  hit(key: string): boolean;
}

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  capacity?: number;
}

// Per-process sliding window — defends against bursts, not a global cap.
export function createRateLimit(opts: RateLimitOptions): RateLimit {
  const capacity = opts.capacity ?? 10_000;
  const map = new Map<string, number[]>();

  return {
    hit(key) {
      const now = Date.now();
      const stamps = (map.get(key) ?? []).filter(
        (t) => now - t < opts.windowMs,
      );
      if (stamps.length >= opts.max) {
        map.set(key, stamps);
        return true;
      }
      stamps.push(now);
      map.set(key, stamps);
      if (map.size > capacity) {
        const overflow = map.size - capacity;
        const keys = map.keys();
        for (let i = 0; i < overflow; i++) map.delete(keys.next().value!);
      }
      return false;
    },
  };
}
