import { Injectable, Logger } from "@nestjs/common";
import { createHash } from "node:crypto";
import { ObservabilityService } from "../observability/observability.service";
import { RedisService } from "../redis/redis.service";
import { GEO_SUPPORTED_RADIUS_KM, gridForCoordinates, type GeoCoordinates, type GeoGrid } from "./geo-utils";

const L1_MAX_KEYS = 5_000;
const L1_MIN_TTL_MS = 5_000;
const L1_MAX_TTL_MS = 15_000;
const L1_REDIS_UNCONFIGURED_TTL_MS = 5_000;
const L2_MIN_TTL_SECONDS = 30;
const L2_MAX_TTL_SECONDS = 90;
const LOCK_TTL_SECONDS = 3;

interface L1Entry {
  value: string;
  expiresAt: number;
}

export interface GeoEpochContext {
  globalEpoch: string;
  cellEpoch: string;
  grid: GeoGrid;
  radiusKm: number;
}

@Injectable()
export class GeoDiscoveryCacheService {
  private readonly logger = new Logger(GeoDiscoveryCacheService.name);
  private readonly l1 = new Map<string, L1Entry>();

  constructor(
    private readonly redis: RedisService,
    private readonly observability: ObservabilityService
  ) {}

  async getEpochContext(grid: GeoGrid, radiusKm: number): Promise<GeoEpochContext> {
    const [globalEpoch, cellEpoch] = await Promise.all([
      this.redis.getStrict(globalEpochKey()),
      this.redis.getStrict(cellEpochKey(grid, radiusKm))
    ]);
    return {
      globalEpoch: globalEpoch && /^\d+$/.test(globalEpoch) ? globalEpoch : "1",
      cellEpoch: cellEpoch && /^\d+$/.test(cellEpoch) ? cellEpoch : "1",
      grid,
      radiusKm
    };
  }

  cacheKey(context: GeoEpochContext, cursorHash: string): string {
    return [
      "geo",
      context.grid.latGrid,
      context.grid.lngGrid,
      context.radiusKm,
      `v${context.globalEpoch}.${context.cellEpoch}`,
      cursorHash
    ].join(":");
  }

  cursorHash(cursor: string | null): string {
    return cursor
      ? createHash("sha256").update(cursor).digest("hex").slice(0, 16)
      : "first";
  }

  async get(key: string): Promise<string | null> {
    const local = this.getL1(key);
    if (local !== null) {
      this.observability.recordGeoCacheHit("l1");
      return local;
    }

    const distributed = await this.redis.getStrict(key);
    if (distributed !== null) {
      this.setL1(key, distributed, jitterMs(L1_MIN_TTL_MS, L1_MAX_TTL_MS));
      this.observability.recordGeoCacheHit("l2");
      return distributed;
    }

    this.observability.recordGeoCacheMiss();
    return null;
  }

  async setIfEpochUnchanged(key: string, context: GeoEpochContext, value: string): Promise<boolean> {
    const latest = await this.getEpochContext(context.grid, context.radiusKm);
    if (latest.globalEpoch !== context.globalEpoch || latest.cellEpoch !== context.cellEpoch) {
      this.observability.recordGeoEpochConflict();
      return false;
    }

    const ok = await this.redis.setExStrict(key, jitterSeconds(L2_MIN_TTL_SECONDS, L2_MAX_TTL_SECONDS), value);
    if (!ok) {
      this.observability.recordGeoRedisDegraded("cache_set");
      if (this.canUseLocalOnlyL1()) {
        this.setL1(key, value, L1_REDIS_UNCONFIGURED_TTL_MS);
        return true;
      }
      this.observability.recordGeoStaleServe("redis_degraded");
      return false;
    }
    this.setL1(key, value, jitterMs(L1_MIN_TTL_MS, L1_MAX_TTL_MS));
    return true;
  }

  async acquireLoadLock(key: string): Promise<boolean> {
    const acquired = await this.redis.setNxEx(`lock:${key}`, LOCK_TTL_SECONDS, "1");
    if (acquired === null) {
      this.observability.recordGeoRedisDegraded("stampede_lock");
      return true;
    }
    return acquired;
  }

  async releaseLoadLock(key: string): Promise<void> {
    await this.redis.del(`lock:${key}`);
  }

  async bumpLocationEpochs(change: { previous: GeoCoordinates | null; next: GeoCoordinates }): Promise<void> {
    this.l1.clear();
    const grids = new Map<string, GeoGrid>();
    grids.set(gridKey(gridForCoordinates(change.next)), gridForCoordinates(change.next));
    if (change.previous) {
      const previousGrid = gridForCoordinates(change.previous);
      grids.set(gridKey(previousGrid), previousGrid);
    }

    const keys = [
      globalEpochKey(),
      ...Array.from(grids.values()).flatMap((grid) =>
        GEO_SUPPORTED_RADIUS_KM.map((radiusKm) => cellEpochKey(grid, radiusKm))
      )
    ];

    const results = await Promise.all(keys.map((key) => this.redis.incr(key)));
    if (results.some((result) => result === null)) {
      this.observability.recordGeoRedisDegraded("epoch_bump");
      this.logger.warn("Geo epoch bump degraded because Redis was unavailable.");
    }
  }

  clearL1(): void {
    this.l1.clear();
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

  private setL1(key: string, value: string, ttlMs: number): void {
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

  private canUseLocalOnlyL1(): boolean {
    return !this.redis.isConfigured && process.env.NODE_ENV !== "production";
  }
}

function globalEpochKey(): string {
  return "geo:epoch:v1:global";
}

function cellEpochKey(grid: GeoGrid, radiusKm: number): string {
  return `geo:epoch:v1:${radiusKm}:${grid.latGrid}:${grid.lngGrid}`;
}

function gridKey(grid: GeoGrid): string {
  return `${grid.latGrid}:${grid.lngGrid}`;
}

function jitterMs(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function jitterSeconds(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}
