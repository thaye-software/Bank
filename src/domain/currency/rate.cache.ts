const CACHE_TTL_MS = 60 * 60 * 1000; // 60 minutes

export interface CachedRate {
  readonly rates: Record<string, number>;
  readonly cachedAt: Date;
  readonly isStale: boolean;
}

interface CacheEntry {
  rates: Record<string, number>;
  cachedAt: Date;
  expiresAt: Date;
}

let cache: CacheEntry | null = null;

export function getCachedRates(now: Date = new Date()): CachedRate | null {
  if (cache === null) return null;

  const isStale = now >= cache.expiresAt;
  return {
    rates: cache.rates,
    cachedAt: cache.cachedAt,
    isStale,
  };
}

export function setCachedRates(rates: Record<string, number>, now: Date = new Date()): void {
  cache = {
    rates,
    cachedAt: now,
    expiresAt: new Date(now.getTime() + CACHE_TTL_MS),
  };
}

export function clearCache(): void {
  cache = null;
}
