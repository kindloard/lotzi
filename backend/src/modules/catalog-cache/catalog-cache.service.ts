import { Injectable, Logger } from "@nestjs/common";
import { RedisService } from "../redis/redis.service";

const L1_TTL_MS = 30_000;
const L1_MAX_KEYS = 5_000;
const VERSION_TTL_SECONDS = 365 * 24 * 60 * 60;

interface L1Entry {
  value: string;
  expiresAt: number;
}

@Injectable()
export class CatalogCacheService {
  private readonly logger = new Logger(CatalogCacheService.name);
  private readonly l1 = new Map<string, L1Entry>();

  constructor(private readonly redis: RedisService) {}

  async get(key: string): Promise<string | null> {
    const local = this.getL1(key);
    if (local !== null) {
      return local;
    }

    const distributed = await this.getDistributed(key);
    if (distributed !== null) {
      this.setL1(key, distributed, L1_TTL_MS);
    }
    return distributed;
  }

  async set(key: string, ttlSeconds: number, value: string): Promise<void> {
    this.setL1(key, value, Math.min(ttlSeconds * 1000, L1_TTL_MS));
    await this.setDistributed(key, ttlSeconds, value);
  }

  async version(scope: string): Promise<string> {
    const key = versionKey(scope);
    const value = await this.getDistributed(key);
    if (value && /^\d+$/.test(value)) {
      return value;
    }
    return "1";
  }

  async bumpScopes(scopes: Iterable<string>): Promise<void> {
    const unique = Array.from(new Set(Array.from(scopes).filter(Boolean))).sort();
    if (!unique.length) {
      return;
    }

    this.clearL1();
    await Promise.all(unique.map(async (scope) => {
      const key = versionKey(scope);
      const version = typeof this.redis.incr === "function" ? await this.redis.incr(key) : null;
      if (version === 1) {
        await this.setDistributed(key, VERSION_TTL_SECONDS, "1");
      }
    }));
    this.logger.debug(`Bumped catalog cache scopes: ${unique.join(",")}`);
  }

  clearL1(): void {
    this.l1.clear();
  }

  storePublicScope(publicId: string) {
    return `store-public:${publicId}`;
  }

  storeSlugScope(slug: string) {
    return `store-slug:${slug}`;
  }

  productPublicScope(publicId: string) {
    return `product-public:${publicId}`;
  }

  categoryScope(storeScope: string, categoryIdOrSlug: string | null | undefined) {
    return categoryIdOrSlug ? `category:${storeScope}:${categoryIdOrSlug}` : "";
  }

  searchScope(storeScope: string) {
    return `search:${storeScope}`;
  }

  landingShopsScope() {
    return "landing:shops";
  }

  dealsScope(scope = "global") {
    return `deals:${scope}`;
  }

  private getL1(key: string): string | null {
    const entry = this.l1.get(key);
    if (!entry) {
      return null;
    }
    if (entry.expiresAt <= Date.now()) {
      this.l1.delete(key);
      return null;
    }
    return entry.value;
  }

  private getDistributed(key: string): Promise<string | null> {
    return typeof this.redis.getStrict === "function"
      ? this.redis.getStrict(key)
      : this.redis.get(key);
  }

  private async setDistributed(key: string, ttlSeconds: number, value: string): Promise<void> {
    if (typeof this.redis.setExStrict === "function") {
      await this.redis.setExStrict(key, ttlSeconds, value);
      return;
    }
    await this.redis.setEx(key, ttlSeconds, value);
  }

  private setL1(key: string, value: string, ttlMs: number): void {
    if (ttlMs <= 0) {
      this.l1.delete(key);
      return;
    }
    if (this.l1.size >= L1_MAX_KEYS) {
      this.pruneL1();
    }
    this.l1.set(key, {
      value,
      expiresAt: Date.now() + ttlMs
    });
  }

  private pruneL1(): void {
    const now = Date.now();
    for (const [key, entry] of this.l1) {
      if (entry.expiresAt <= now || this.l1.size >= L1_MAX_KEYS) {
        this.l1.delete(key);
      }
      if (this.l1.size < L1_MAX_KEYS) {
        return;
      }
    }
  }
}

function versionKey(scope: string) {
  return `catalog:version:v1:${scope}`;
}
