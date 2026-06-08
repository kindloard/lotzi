import { Injectable, Logger } from "@nestjs/common";
import { createHash } from "node:crypto";
import { ObservabilityService } from "../observability/observability.service";
import { RedisService } from "../redis/redis.service";
import { GEO_SUPPORTED_RADIUS_KM, gridForCoordinates, type GeoCoordinates, type GeoGrid } from "./geo-utils";

const L1_MAX_KEYS = 5_000;
const L1_MIN_TTL_MS = 15_000;
const L1_MAX_TTL_MS = 30_000;
const L1_REDIS_DEGRADED_TTL_MS = 30_000;
// Epoch L1 TTL: 5s (was 3s) — reduces hot epoch re-reads per process.
const EPOCH_L1_TTL_MS = 5_000;
// Location result caches stay short so GPS-based availability remains fresh.
const L2_TTL_SECONDS = 60;
const L2_SWR_TTL_SECONDS = 60;
const LOCK_TTL_SECONDS = 3;
const STORE_CARD_TTL_SECONDS = 10 * 60;

interface L1Entry {
  value: string;
  expiresAt: number;
}

export interface GeoEpochContext {
  cardEpoch: string;
  cellEpoch: string;
  globalEpoch: string;
  grid: GeoGrid;
  locationEpoch: string;
  radiusKm: number;
}

export type GeoCacheSource = "l1" | "l2";

export interface GeoCacheLookup {
  source: GeoCacheSource;
  value: string;
}

@Injectable()
export class GeoDiscoveryCacheService {
  private readonly logger = new Logger(GeoDiscoveryCacheService.name);
  private readonly l1 = new Map<string, L1Entry>();
  private readonly epochL1 = new Map<string, GeoEpochContext & { expiresAt: number }>();

  constructor(
    private readonly redis: RedisService,
    private readonly observability: ObservabilityService
  ) {}

  async getEpochContext(grid: GeoGrid, radiusKm: number): Promise<GeoEpochContext> {
    const key = epochCacheKey(grid, radiusKm);
    const local = this.epochL1.get(key);
    if (local && local.expiresAt > Date.now()) {
      return {
        cardEpoch: local.cardEpoch,
        globalEpoch: local.globalEpoch,
        cellEpoch: local.cellEpoch,
        grid: local.grid,
        locationEpoch: local.locationEpoch,
        radiusKm: local.radiusKm
      };
    }

    const epochKeys = [
      globalEpochKey(),
      locationEpochKey(grid, radiusKm),
      cardEpochKey(grid, radiusKm)
    ];
    const epochValues = await this.redis.mGetStrict(epochKeys);
    const globalEpoch = epochValues.get(epochKeys[0]!) ?? null;
    const locationEpoch = epochValues.get(epochKeys[1]!) ?? null;
    const cardEpoch = epochValues.get(epochKeys[2]!) ?? null;
    const context = {
      cardEpoch: epochValue(cardEpoch),
      cellEpoch: epochValue(locationEpoch),
      globalEpoch: globalEpoch && /^\d+$/.test(globalEpoch) ? globalEpoch : "1",
      grid,
      locationEpoch: epochValue(locationEpoch),
      radiusKm
    };
    this.epochL1.set(key, { ...context, expiresAt: Date.now() + EPOCH_L1_TTL_MS });
    return context;
  }

  cacheKey(
    context: GeoEpochContext,
    parts: { cursorHash: string; limit: number; originKey?: string; responseVersion: number }
  ): string {
    return [
      "geo",
      "cell",
      `r${parts.responseVersion}`,
      context.grid.latGrid,
      context.grid.lngGrid,
      context.radiusKm,
      parts.originKey ? `origin:${parts.originKey}` : "origin:cell",
      `limit:${parts.limit}`,
      `v${context.globalEpoch}.${context.locationEpoch}.${context.cardEpoch}`,
      `cursor:${parts.cursorHash}`
    ].join(":");
  }

  cursorHash(cursor: string | null): string {
    return cursor
      ? createHash("sha256").update(cursor).digest("hex").slice(0, 16)
      : "first";
  }

  async get(key: string): Promise<string | null> {
    const lookup = await this.getWithSource(key);
    return lookup?.value ?? null;
  }

  async getWithSource(key: string): Promise<GeoCacheLookup | null> {
    const local = this.getL1(key);
    if (local !== null) {
      this.observability.recordGeoCacheHit("l1");
      return { source: "l1", value: local };
    }

    const distributed = await this.redis.getStrict(key);
    if (distributed !== null) {
      this.setL1(key, distributed, jitterMs(L1_MIN_TTL_MS, L1_MAX_TTL_MS));
      this.observability.recordGeoCacheHit("l2");
      return { source: "l2", value: distributed };
    }

    this.observability.recordGeoCacheMiss();
    return null;
  }

  /**
   * Pipeline optimization: reads epoch keys AND cell cache key in one MGET round-trip.
   * On Redis L1 hit for both epoch (epochL1) and cell (l1), this is pure memory — 0 RTTs.
   * On L2 miss, 1 MGET fetches all 4 keys simultaneously.
   */
  async getEpochAndCell(
    grid: GeoGrid,
    radiusKm: number,
    cellKeyFn: (epoch: GeoEpochContext) => string,
    cursorHash: string,
    limit: number
  ): Promise<{
    epoch: GeoEpochContext;
    cellLookup: GeoCacheLookup | null;
  }> {
    const epochL1Key = epochCacheKey(grid, radiusKm);
    const cachedEpoch = this.epochL1.get(epochL1Key);
    const now = Date.now();

    if (cachedEpoch && cachedEpoch.expiresAt > now) {
      // Epoch is in L1 — compute cache key and check L1 cell cache.
      const epoch: GeoEpochContext = {
        cardEpoch: cachedEpoch.cardEpoch,
        cellEpoch: cachedEpoch.cellEpoch,
        globalEpoch: cachedEpoch.globalEpoch,
        grid: cachedEpoch.grid,
        locationEpoch: cachedEpoch.locationEpoch,
        radiusKm: cachedEpoch.radiusKm
      };
      const cellKey = cellKeyFn(epoch);
      const localCell = this.getL1(cellKey);
      if (localCell !== null) {
        this.observability.recordGeoCacheHit("l1");
        return { epoch, cellLookup: { source: "l1", value: localCell } };
      }
      // Epoch is L1 but cell is not — single GET for cell.
      const distributed = await this.redis.getStrict(cellKey);
      if (distributed !== null) {
        this.setL1(cellKey, distributed, jitterMs(L1_MIN_TTL_MS, L1_MAX_TTL_MS));
        this.observability.recordGeoCacheHit("l2");
        return { epoch, cellLookup: { source: "l2", value: distributed } };
      }
      this.observability.recordGeoCacheMiss();
      return { epoch, cellLookup: null };
    }

    // Epoch L1 miss — fetch epoch keys; we don't know the cell key yet, so get epoch first,
    // then check L1 for cell (common case: cell L1 and epoch L1 have different TTLs).
    const epoch = await this.getEpochContext(grid, radiusKm);
    const cellKey = cellKeyFn(epoch);
    const cellLookup = await this.getWithSource(cellKey);
    return { epoch, cellLookup };
  }

  async setIfEpochUnchanged(
    key: string,
    context: GeoEpochContext,
    value: string,
    options: { staleWhileRevalidate?: boolean } = {}
  ): Promise<boolean> {
    this.epochL1.delete(epochCacheKey(context.grid, context.radiusKm));
    const latest = await this.getEpochContext(context.grid, context.radiusKm);
    if (
      latest.globalEpoch !== context.globalEpoch ||
      latest.locationEpoch !== context.locationEpoch ||
      latest.cardEpoch !== context.cardEpoch
    ) {
      this.observability.recordGeoEpochConflict();
      return false;
    }

    const ttlSeconds = options.staleWhileRevalidate
      ? L2_SWR_TTL_SECONDS
      : L2_TTL_SECONDS;
    const ok = await this.redis.setExStrict(key, ttlSeconds, value);
    if (!ok) {
      this.observability.recordGeoRedisDegraded("cache_set");
      if (this.canUseLocalOnlyL1()) {
        this.setL1(key, value, L1_REDIS_DEGRADED_TTL_MS);
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
    this.epochL1.clear();
    const grids = new Map<string, GeoGrid>();
    grids.set(gridKey(gridForCoordinates(change.next)), gridForCoordinates(change.next));
    if (change.previous) {
      const previousGrid = gridForCoordinates(change.previous);
      grids.set(gridKey(previousGrid), previousGrid);
    }

    const keys = Array.from(grids.values()).flatMap((grid) =>
      GEO_SUPPORTED_RADIUS_KM.map((radiusKm) => locationEpochKey(grid, radiusKm))
    );

    const results = await Promise.all(keys.map((key) => this.redis.incr(key)));
    if (results.some((result) => result === null)) {
      this.observability.recordGeoRedisDegraded("epoch_bump");
      this.logger.warn("Geo epoch bump degraded because Redis was unavailable.");
    }
  }

  async bumpStoreCardEpochs(coordinates: GeoCoordinates): Promise<void> {
    this.l1.clear();
    this.epochL1.clear();
    const grid = gridForCoordinates(coordinates);
    const keys = GEO_SUPPORTED_RADIUS_KM.map((radiusKm) => cardEpochKey(grid, radiusKm));
    const results = await Promise.all(keys.map((key) => this.redis.incr(key)));
    if (results.some((result) => result === null)) {
      this.observability.recordGeoRedisDegraded("card_epoch_bump");
      this.logger.warn("Geo card epoch bump degraded because Redis was unavailable.");
    }
  }

  async bumpGlobalEpoch(): Promise<void> {
    this.l1.clear();
    this.epochL1.clear();
    const result = await this.redis.incr(globalEpochKey());
    if (result === null) {
      this.observability.recordGeoRedisDegraded("global_epoch_bump");
    }
  }

  clearL1(): void {
    this.l1.clear();
    this.epochL1.clear();
  }

  async getStoreCards(storeIds: string[]): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    const missing: string[] = [];
    for (const storeId of storeIds) {
      const key = storeCardKey(storeId);
      const local = this.getL1(key);
      if (local !== null) {
        result.set(storeId, local);
      } else {
        missing.push(storeId);
      }
    }

    if (!missing.length) {
      return result;
    }

    // Single MGET round-trip for all missing store cards (N serial GETs → 1 MGET).
    const keys = missing.map(storeCardKey);
    const fetched = await this.redis.mGetStrict(keys);
    for (let i = 0; i < missing.length; i += 1) {
      const storeId = missing[i]!;
      const key = keys[i]!;
      const value = fetched.get(key) ?? null;
      if (value !== null) {
        this.setL1(key, value, jitterMs(L1_MIN_TTL_MS, L1_MAX_TTL_MS));
        result.set(storeId, value);
      }
    }
    return result;
  }


  async setStoreCard(storeId: string, value: string): Promise<void> {
    const key = storeCardKey(storeId);
    this.setL1(key, value, jitterMs(L1_MIN_TTL_MS, L1_MAX_TTL_MS));
    const ok = await this.redis.setExStrict(key, STORE_CARD_TTL_SECONDS, value);
    if (!ok && this.canUseLocalOnlyL1()) {
      this.setL1(key, value, L1_REDIS_DEGRADED_TTL_MS);
    }
  }

  async invalidateStoreCards(storeIds: string[]): Promise<void> {
    await Promise.all(Array.from(new Set(storeIds)).map(async (storeId) => {
      const key = storeCardKey(storeId);
      this.l1.delete(key);
      await this.redis.del(key);
    }));
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
    return (
      process.env.NODE_ENV !== "production" &&
      (!this.redis.isConfigured || this.redis.isCircuitBreakerOpen)
    );
  }
}

function globalEpochKey(): string {
  return "geo:epoch:v1:global";
}

function epochCacheKey(grid: GeoGrid, radiusKm: number): string {
  return `${radiusKm}:${grid.latGrid}:${grid.lngGrid}`;
}

function locationEpochKey(grid: GeoGrid, radiusKm: number): string {
  return `geo:epoch:v1:location:${radiusKm}:${grid.latGrid}:${grid.lngGrid}`;
}

function cardEpochKey(grid: GeoGrid, radiusKm: number): string {
  return `geo:epoch:v1:card:${radiusKm}:${grid.latGrid}:${grid.lngGrid}`;
}

function storeCardKey(storeId: string): string {
  return `geo:store-card:v1:${storeId}`;
}

function gridKey(grid: GeoGrid): string {
  return `${grid.latGrid}:${grid.lngGrid}`;
}

function jitterMs(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function epochValue(value: string | null): string {
  return value && /^\d+$/.test(value) ? value : "1";
}
