interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  updatedAt: number;
}

export class TtlCache<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private defaultTtlMs: number;

  constructor(defaultTtlMs: number = 30000) {
    this.defaultTtlMs = defaultTtlMs;
  }

  set(key: string, value: T, ttlMs?: number): void {
    const ttl = ttlMs ?? this.defaultTtlMs;
    const now = Date.now();
    this.cache.set(key, {
      value,
      expiresAt: now + ttl,
      updatedAt: now,
    });
  }

  get(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      return null;
    }
    return entry.value;
  }

  /**
   * Returns value even if expired, along with stale flag.
   * Useful when simulator is down and degraded mode activates.
   */
  getWithStale(key: string): { value: T | null; isStale: boolean; ageMs: number } {
    const entry = this.cache.get(key);
    if (!entry) {
      return { value: null, isStale: true, ageMs: Infinity };
    }
    const now = Date.now();
    const isStale = now > entry.expiresAt;
    return {
      value: entry.value,
      isStale,
      ageMs: now - entry.updatedAt,
    };
  }

  invalidate(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }
}
