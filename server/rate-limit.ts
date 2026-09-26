interface Bucket {
  tokens: number;
  updatedAt: number;
}

/**
 * Token-bucket rate limiting per key: a key can use up to `capacity`
 * actions at once, and regains `perSecond` of them every second.
 */
export class RateLimiter {
  readonly #buckets = new Map<string, Bucket>();
  readonly #capacity: number;
  readonly #perMs: number;
  readonly #now: () => number;

  constructor({
    capacity,
    perSecond,
    now = Date.now,
  }: {
    capacity: number;
    perSecond: number;
    now?: () => number;
  }) {
    this.#capacity = capacity;
    this.#perMs = perSecond / 1000;
    this.#now = now;
  }

  /** Uses one action for `key`. Returns false, using nothing, if none are left. */
  take(key: string): boolean {
    const now = this.#now();
    const tokens = this.#available(this.#buckets.get(key), now);
    if (tokens < 1) return false;
    this.#buckets.set(key, { tokens: tokens - 1, updatedAt: now });
    return true;
  }

  forget(key: string): void {
    this.#buckets.delete(key);
  }

  /** Drops keys that have fully recovered, so memory doesn't grow without bound. */
  prune(): void {
    const now = this.#now();
    for (const [key, bucket] of this.#buckets) {
      if (this.#available(bucket, now) >= this.#capacity) this.#buckets.delete(key);
    }
  }

  get size(): number {
    return this.#buckets.size;
  }

  #available(bucket: Bucket | undefined, now: number): number {
    if (bucket === undefined) return this.#capacity;
    return Math.min(this.#capacity, bucket.tokens + (now - bucket.updatedAt) * this.#perMs);
  }
}
