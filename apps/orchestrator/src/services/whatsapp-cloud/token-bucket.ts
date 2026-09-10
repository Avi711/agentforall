import { TOKEN_BUCKET_PRUNE_AT } from "../../domain/whatsapp-cloud.js";

// A per-key token bucket: `rate` tokens per second, burst up to `rate`, keys idle past `idleMs` are dropped.
export class TokenBuckets {
  private readonly buckets = new Map<string, { tokens: number; at: number }>();

  constructor(
    private readonly rate: number,
    private readonly now: () => Date = () => new Date(),
    private readonly idleMs = 60_000,
  ) {}

  take(key: string): boolean {
    const nowMs = this.now().getTime();
    const bucket = this.buckets.get(key) ?? { tokens: this.rate, at: nowMs };
    bucket.tokens = Math.min(this.rate, bucket.tokens + ((nowMs - bucket.at) / 1000) * this.rate);
    bucket.at = nowMs;
    if (bucket.tokens < 1) {
      this.buckets.set(key, bucket);
      return false;
    }
    bucket.tokens -= 1;
    this.buckets.set(key, bucket);
    this.prune(nowMs);
    return true;
  }

  private prune(nowMs: number): void {
    if (this.buckets.size < TOKEN_BUCKET_PRUNE_AT) return;
    for (const [key, bucket] of this.buckets) {
      if (nowMs - bucket.at > this.idleMs) this.buckets.delete(key);
    }
  }
}
