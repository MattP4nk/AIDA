import { injectable, inject } from "tsyringe";
import type { Logger } from "pino";
import { LOGGER } from "../di/tokens";

interface CacheEntry<T> {
  value: T;
  expiry: number; // Timestamp
}

@injectable()
export class CacheService {
  private cache: Map<string, CacheEntry<any>> = new Map();
  private cleanupInterval: NodeJS.Timeout;
  private readonly DEFAULT_TTL = 60; // 1 minute default

  constructor(@inject(LOGGER) private logger: Logger) {
    // Run cleanup every minute
    this.cleanupInterval = setInterval(() => this.cleanup(), 60 * 1000);
    this.logger.info("CacheService initialized");
  }

  /**
   * Get a value from cache
   */
  public get<T>(key: string): T | undefined {
    const entry = this.cache.get(key);

    if (!entry) {
      return undefined;
    }

    if (Date.now() > entry.expiry) {
      this.cache.delete(key);
      return undefined;
    }

    return entry.value as T;
  }

  /**
   * Set a value in cache
   * @param ttlSeconds Time to live in seconds (default: 60)
   */
  public set(key: string, value: any, ttlSeconds: number = this.DEFAULT_TTL): void {
    const expiry = Date.now() + ttlSeconds * 1000;
    this.cache.set(key, { value, expiry });
  }

  /**
   * Delete a value from cache
   */
  public del(key: string): void {
    this.cache.delete(key);
  }

  /**
   * Clear all cache
   */
  public flush(): void {
    this.cache.clear();
  }

  /**
   * Get cache stats
   */
  public getStats(): { size: number; memoryUsage: number } {
    return {
      size: this.cache.size,
      memoryUsage: process.memoryUsage().heapUsed,
    };
  }

  /**
   * Cleanup expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    let expiredCount = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiry) {
        this.cache.delete(key);
        expiredCount++;
      }
    }

    if (expiredCount > 0) {
      // console.log(`🧹 Cache cleanup: removed ${expiredCount} expired entries`);
    }
  }

  public dispose(): void {
    clearInterval(this.cleanupInterval);
  }
}
