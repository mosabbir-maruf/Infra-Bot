import { Logger } from '../utils/Logger';

export interface RateLimiter {
  isRateLimited(key: string, limit: number, windowSeconds: number): Promise<boolean>;
}

export class InMemoryRateLimiter implements RateLimiter {
  private cache = new Map<string, { count: number; expiresAt: number }>();

  public isRateLimited(key: string, limit: number, windowSeconds: number): Promise<boolean> {
    const now = Date.now();
    const record = this.cache.get(key);

    if (!record || now > record.expiresAt) {
      this.cache.set(key, {
        count: 1,
        expiresAt: now + windowSeconds * 1000,
      });
      return Promise.resolve(false);
    }

    if (record.count >= limit) {
      return Promise.resolve(true);
    }

    record.count += 1;
    return Promise.resolve(false);
  }
}

export class CloudflareKVRateLimiter implements RateLimiter {
  private kvNamespace: { get(key: string): Promise<string | null>; put(key: string, val: string, options?: { expirationTtl?: number }): Promise<void> };
  private fallback: InMemoryRateLimiter;
  private readonly hasKv: boolean;

  constructor(kvNamespace: unknown) {
    this.kvNamespace = kvNamespace as { get(key: string): Promise<string | null>; put(key: string, val: string, options?: { expirationTtl?: number }): Promise<void> };
    this.fallback = new InMemoryRateLimiter();
    this.hasKv = !!(kvNamespace && typeof (kvNamespace as Record<string, unknown>).get === 'function');
  }

  public async isRateLimited(key: string, limit: number, windowSeconds: number): Promise<boolean> {
    if (!this.hasKv) {
      Logger.warn('RateLimiter: KV Namespace not bound. Falling back to InMemory rate limiting.');
      return this.fallback.isRateLimited(key, limit, windowSeconds);
    }

    try {
      const currentVal = await this.kvNamespace.get(key);
      const count = currentVal ? parseInt(currentVal, 10) : 0;

      if (count >= limit) {
        return true;
      }

      await this.kvNamespace.put(key, String(count + 1), { expirationTtl: windowSeconds });
      return false;
    } catch (err) {
      Logger.error('RateLimiter: Cloudflare KV operation failed. Falling back to InMemory.', err);
      return this.fallback.isRateLimited(key, limit, windowSeconds);
    }
  }
}
