import { ForbiddenException, HttpException, HttpStatus, Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma, ProductStatus, StoreStatus } from "@prisma/client";
import { createHash } from "node:crypto";
import {
  publicStoreCode,
  publicStoreSlug
} from "../../common/public-catalog-route";
import { PrismaService } from "../../database/prisma.service";
import { ObservabilityService } from "../observability/observability.service";
import { RateLimitService } from "../rate-limit/rate-limit.service";
import type { ShopDto } from "../shops/shops.service";
import { GeoCursorService, type VerifiedGeoCursor } from "./geo-cursor.service";
import { GeoDiscoveryCacheService } from "./geo-discovery-cache.service";
import { GeoFraudService } from "./geo-fraud.service";
import {
  coordinatesFromGrid,
  formatApproximateDistance,
  GEO_GRID_CELL_BUFFER_METERS,
  gridForCoordinates,
  numberFromDb,
  parseGridValue,
  parseLatitude,
  parseLimit,
  parseLongitude,
  parseRadiusKm,
  radiusMeters,
  sleep,
  type GeoCoordinates,
  type GeoGrid
} from "./geo-utils";

interface NearbyInput {
  latitude?: unknown;
  longitude?: unknown;
  latGrid?: unknown;
  lngGrid?: unknown;
  radiusKm?: unknown;
  limit: unknown;
  cursor?: string | null;
  ip: string;
  userId?: string | null;
  deviceId?: string | null;
  publicCell?: boolean;
}

// SWR: serve cached response and trigger background refresh after 2 minutes.
const GEO_SWR_FRESH_MS = 120_000;

interface GeoCandidateRow {
  id: string;
  distance_meters: number | string | Prisma.Decimal;
}

interface GeoDiscoveryCardRow {
  store_id: string;
  public_code: string | null;
  public_slug: string;
  name: string;
  slug: string;
  type: string;
  type_name: string;
  lat: number | string | Prisma.Decimal | null;
  lng: number | string | Prisma.Decimal | null;
  delivery_time: string;
  delivery_fee: string;
  image_url: string | null;
  logo_url: string | null;
  banner_url: string | null;
  featured_product: string;
  branding_json: Prisma.JsonValue | null;
  business_hours_json: Prisma.JsonValue | null;
  delivery_radius_km: number | string | Prisma.Decimal | null;
  distance_meters: number | string | Prisma.Decimal;
}

interface NearbyCacheEnvelope {
  version: 1;
  cachedAt: number;
  data: GeoNearbyResponse;
}

export interface GeoNearbyResponse {
  apiVersion: "v1";
  radiusKm: number;
  items: ShopDto[];
  pageInfo: {
    limit: number;
    hasNextPage: boolean;
    nextCursor: string | null;
  };
  cache?: {
    ageMs: number;
    grid: GeoGrid;
    source: "l1" | "l2" | "miss";
  };
}

export interface GeoNearbyResult {
  data: GeoNearbyResponse;
  cacheHit: boolean;
  cacheSource: "l1" | "l2" | "miss";
  timings: GeoTimingSegment[];
}

export interface GeoTimingSegment {
  name: string;
  durationMs: number;
}

@Injectable()
export class GeoDiscoveryService {
  private readonly logger = new Logger(GeoDiscoveryService.name);
  private readonly cardReadModelEnabled: boolean;
  private readonly enabled: boolean;
  private readonly defaultRadiusKm: number;
  private readonly swrEnabled: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: GeoDiscoveryCacheService,
    private readonly cursor: GeoCursorService,
    private readonly rateLimit: RateLimitService,
    private readonly fraud: GeoFraudService,
    private readonly observability: ObservabilityService,
    config: ConfigService
  ) {
    this.enabled = config.get<boolean>("SHOP_DISCOVERY_ENABLED", true);
    this.defaultRadiusKm = config.get<number>("SHOP_DISCOVERY_RADIUS_KM", 3);
    this.cardReadModelEnabled = config.get<boolean>("SHOP_DISCOVERY_CARD_READ_MODEL_ENABLED", false);
    this.swrEnabled = config.get<boolean>("SHOP_DISCOVERY_SWR_ENABLED", false);
  }

  async nearby(input: NearbyInput): Promise<GeoNearbyResult> {
    if (!this.enabled) {
      throw new ServiceUnavailableException({
        apiVersion: "v1",
        code: "SHOP_DISCOVERY_DISABLED",
        message: "Shop discovery is temporarily unavailable."
      });
    }

    const timing = new GeoTiming();
    const location = this.parseRequestLocation(input);
    const limit = parseLimit(input.limit);
    const radiusKm = parseRadiusKm(input.radiusKm, this.defaultRadiusKm);
    if (radiusKm > this.defaultRadiusKm) {
      this.observability.recordGeoRadiusExpansion(this.defaultRadiusKm, radiusKm);
    }
    const grid = location.grid;
    const coordinates = location.coordinates;
    const originKey = input.publicCell ? null : coordinatesCacheKey(coordinates);
    const sessionHash = input.publicCell ? null : sessionHashFor(input.deviceId ?? input.userId ?? null);
    const cursorState = input.cursor
      ? this.cursor.verify(input.cursor, { grid, originKey, radiusKm, sessionHash })
      : null;
    const cursorHash = this.cache.cursorHash(input.cursor ?? null);
    timing.mark("geo-parse");

    if (input.publicCell) {
      // Hot path: pipeline epoch + cell lookup into one logical operation.
      // L1/L1: 0 RTTs (pure memory). L1-epoch/L2-cell: 1 RTT. L2-epoch: 1 MGET + 1 GET.
      const { epoch, cellLookup } = await this.cache.getEpochAndCell(
        grid,
        radiusKm,
        (ctx) => this.cache.cacheKey(ctx, { cursorHash, limit, responseVersion: 1 }),
        cursorHash,
        limit
      );
      const cacheKey = this.cache.cacheKey(epoch, { cursorHash, limit, responseVersion: 1 });
      timing.mark("geo-cache");

      const cached = parseCacheEnvelopeWithSource(cellLookup);
      if (cached) {
        if (this.swrEnabled && isStaleForSwr(cached.envelope)) {
          this.refreshCachedNearby({
            cacheKey,
            coordinates,
            cursorState,
            epoch,
            grid,
            limit,
            originKey,
            radiusKm,
            sessionHash,
            useCellBuffer: false
          });
        }
        const data = withCacheMetadata(cached.envelope.data, {
          ageMs: Math.max(0, Date.now() - cached.envelope.cachedAt),
          grid,
          source: cached.source
        });
        this.observability.observeGeoSearch("hit", timing.totalMs());
        this.recordNearbyResponse(data, grid, cached.source, timing.totalMs());
        return { data, cacheHit: true, cacheSource: cached.source, timings: timing.done() };
      }

      // Cache miss for public cell — acquire lock and load from DB.
      const lockAcquired = await this.cache.acquireLoadLock(cacheKey);
      if (!lockAcquired) {
        const waitStarted = process.hrtime.bigint();
        await sleep(75);
        this.observability.observeGeoStampedeLockWait(durationMs(waitStarted));
        const warmed = parseCacheEnvelopeWithSource(await this.cache.getWithSource(cacheKey));
        if (warmed) {
          timing.mark("geo-stampede-wait");
          const data = withCacheMetadata(warmed.envelope.data, {
            ageMs: Math.max(0, Date.now() - warmed.envelope.cachedAt),
            grid,
            source: warmed.source
          });
          this.observability.observeGeoSearch("hit", timing.totalMs());
          this.recordNearbyResponse(data, grid, warmed.source, timing.totalMs());
          return { data, cacheHit: true, cacheSource: warmed.source, timings: timing.done() };
        }
      }

      try {
        const data = await this.loadNearby({
          coordinates, grid, limit, cursorState, sessionHash, radiusKm,
          originKey,
          useCellBuffer: false, timing
        });
        const cachedValue = JSON.stringify({ version: 1, cachedAt: Date.now(), data } satisfies NearbyCacheEnvelope);
        const cacheWritten = await this.cache.setIfEpochUnchanged(cacheKey, epoch, cachedValue, {
          staleWhileRevalidate: this.swrEnabled
        });
        if (!cacheWritten) {
          this.observability.recordGeoStaleServe("epoch_conflict");
        }
        const dataWithMetadata = withCacheMetadata(data, { ageMs: 0, grid, source: "miss" });
        this.observability.observeGeoSearch("miss", timing.totalMs());
        this.recordNearbyResponse(dataWithMetadata, grid, "miss", timing.totalMs());
        return { data: dataWithMetadata, cacheHit: false, cacheSource: "miss", timings: timing.done() };
      } finally {
        if (lockAcquired) {
          await this.cache.releaseLoadLock(cacheKey);
        }
      }
    }

    // Private cell path (authenticated nearby with exact coordinates).
    const epoch = await this.cache.getEpochContext(grid, radiusKm);
    const cacheKey = this.cache.cacheKey(epoch, { cursorHash, limit, originKey: originKey ?? undefined, responseVersion: 1 });
    timing.mark("geo-cache");

    await this.enforceAbuseControls({ coordinates, grid, input });
    timing.mark("geo-rate-limit");

    const privateCached = parseCacheEnvelopeWithSource(await this.cache.getWithSource(cacheKey));
    timing.mark("geo-cache-private");
    if (privateCached) {
      const data = withCacheMetadata(privateCached.envelope.data, {
        ageMs: Math.max(0, Date.now() - privateCached.envelope.cachedAt),
        grid,
        source: privateCached.source
      });
      this.observability.observeGeoSearch("hit", timing.totalMs());
      this.recordNearbyResponse(data, grid, privateCached.source, timing.totalMs());
      return { data, cacheHit: true, cacheSource: privateCached.source, timings: timing.done() };
    }

    const lockAcquired = await this.cache.acquireLoadLock(cacheKey);
    if (!lockAcquired) {
      const waitStarted = process.hrtime.bigint();
      await sleep(75);
      this.observability.observeGeoStampedeLockWait(durationMs(waitStarted));
      const warmed = parseCacheEnvelopeWithSource(await this.cache.getWithSource(cacheKey));
      if (warmed) {
        timing.mark("geo-stampede-wait");
        const data = withCacheMetadata(warmed.envelope.data, {
          ageMs: Math.max(0, Date.now() - warmed.envelope.cachedAt),
          grid,
          source: warmed.source
        });
        this.observability.observeGeoSearch("hit", timing.totalMs());
        this.recordNearbyResponse(data, grid, warmed.source, timing.totalMs());
        return { data, cacheHit: true, cacheSource: warmed.source, timings: timing.done() };
      }
    }

    try {
      const data = await this.loadNearby({
        coordinates,
        grid,
        limit,
        cursorState,
        originKey,
        sessionHash,
        radiusKm,
        useCellBuffer: false,
        timing
      });
      const cachedValue = JSON.stringify({ version: 1, cachedAt: Date.now(), data } satisfies NearbyCacheEnvelope);
      const cacheWritten = await this.cache.setIfEpochUnchanged(cacheKey, epoch, cachedValue, {
        staleWhileRevalidate: this.swrEnabled && Boolean(input.publicCell)
      });
      if (!cacheWritten) {
        this.observability.recordGeoStaleServe("epoch_conflict");
      }
      const dataWithMetadata = withCacheMetadata(data, { ageMs: 0, grid, source: "miss" });
      this.observability.observeGeoSearch("miss", timing.totalMs());
      this.recordNearbyResponse(dataWithMetadata, grid, "miss", timing.totalMs());
      return { data: dataWithMetadata, cacheHit: false, cacheSource: "miss", timings: timing.done() };
    } finally {
      if (lockAcquired) {
        await this.cache.releaseLoadLock(cacheKey);
      }
    }
  }

  private parseRequestLocation(input: NearbyInput): { coordinates: GeoCoordinates; grid: GeoGrid } {
    if (input.publicCell) {
      const grid = {
        latGrid: parseGridValue(input.latGrid, "latGrid"),
        lngGrid: parseGridValue(input.lngGrid, "lngGrid")
      };
      return { coordinates: coordinatesFromGrid(grid), grid };
    }
    const coordinates = this.parseCoordinates(input.latitude, input.longitude);
    return { coordinates, grid: gridForCoordinates(coordinates) };
  }

  private parseCoordinates(latitude: unknown, longitude: unknown): GeoCoordinates {
    try {
      return {
        latitude: parseLatitude(latitude),
        longitude: parseLongitude(longitude)
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("latitude")) {
        this.observability.recordGeoInvalidCoordinate("latitude");
      } else if (message.includes("longitude")) {
        this.observability.recordGeoInvalidCoordinate("longitude");
      } else {
        this.observability.recordGeoInvalidCoordinate("unknown");
      }
      throw error;
    }
  }

  private async enforceAbuseControls(input: {
    coordinates: GeoCoordinates;
    grid: GeoGrid;
    input: NearbyInput;
  }): Promise<void> {
    const fraudDecision = await this.fraud.assess({
      coordinates: input.coordinates,
      ip: input.input.ip,
      userId: input.input.userId,
      deviceId: input.input.deviceId
    });
    if (fraudDecision === "reject") {
      throw new ForbiddenException({
        apiVersion: "v1",
        code: "GEO_DISCOVERY_BLOCKED",
        message: "Shop discovery is unavailable for this request."
      });
    }

    const multiplier = fraudDecision === "throttle" ? 0.25 : 1;
    await Promise.all([
      this.consumeBudget("ip", `geo:rl:ip:${input.input.ip}`, Math.floor(120 * multiplier), 60, 30),
      this.consumeBudget("grid", `geo:rl:grid:${input.grid.latGrid}:${input.grid.lngGrid}`, Math.floor(600 * multiplier), 60, 120),
      input.input.deviceId
        ? this.consumeBudget("device", `geo:rl:device:${input.input.deviceId}`, Math.floor(180 * multiplier), 60, 45)
        : Promise.resolve(),
      input.input.userId
        ? this.consumeBudget("user", `geo:rl:user:${input.input.userId}`, Math.floor(240 * multiplier), 60, 60)
        : Promise.resolve()
    ]);
  }

  private async consumeBudget(
    bucket: string,
    key: string,
    limit: number,
    windowSeconds: number,
    degradedLimit: number
  ): Promise<void> {
    const result = await this.rateLimit.consume(key, Math.max(1, limit), windowSeconds, {
      degradedLimit: Math.max(1, degradedLimit)
    });
    if (result.degraded) {
      this.observability.recordGeoRedisDegraded(`rate_limit_${bucket}`);
    }
    if (result.allowed) {
      return;
    }
    this.observability.recordGeoRateLimited(bucket);
    throw new HttpException(
      {
        apiVersion: "v1",
        code: "GEO_RATE_LIMITED",
        message: "Too many nearby shop requests. Please retry later.",
        retryAfterSeconds: result.retryAfterSeconds
      },
      HttpStatus.TOO_MANY_REQUESTS
    );
  }

  private async loadNearby(input: {
    coordinates: GeoCoordinates;
    grid: GeoGrid;
    limit: number;
    cursorState: VerifiedGeoCursor | null;
    sessionHash: string | null;
    originKey: string | null;
    radiusKm: number;
    useCellBuffer: boolean;
    timing: GeoTiming;
  }): Promise<GeoNearbyResponse> {
    if (this.cardReadModelEnabled) {
      return this.loadNearbyFromReadModel(input);
    }

    const queryStarted = process.hrtime.bigint();
    const candidates = await this.queryCandidates(
      input.coordinates,
      input.limit,
      input.cursorState,
      input.radiusKm,
      input.useCellBuffer
    );
    this.observability.observeGeoQuery(durationMs(queryStarted));
    input.timing.mark("geo-candidates");

    const hasNextPage = candidates.length > input.limit;
    const pageCandidates = candidates.slice(0, input.limit);
    const storeCards = await this.fetchStoreCards(pageCandidates.map((candidate) => candidate.id));
    input.timing.mark("geo-hydrate");
    const items = pageCandidates.flatMap((candidate) => {
      const store = storeCards.get(candidate.id);
      if (!store) {
        return [];
      }
      const distanceMeters = Math.max(0, Math.round(numberFromDb(candidate.distance_meters) ?? 0));
      return [{
        ...store,
        distance: formatApproximateDistance(distanceMeters),
        distanceMeters,
        distanceAccuracyMeters: null,
        distanceSource: "straight_line" as const
      }];
    });
    const hydrationMisses = pageCandidates.length - items.length;
    if (candidates.length === 0) {
      this.observability.recordGeoFilterRejection("radius", input.radiusKm);
    }
    if (hydrationMisses > 0) {
      this.observability.recordGeoFilterRejection("hydration_missing", input.radiusKm);
    }
    this.logger.debug(JSON.stringify({
      candidates: candidates.length,
      event: "geo_candidate_hydration",
      grid: input.grid,
      hydratedItems: items.length,
      hydrationMisses,
      pageCandidates: pageCandidates.length,
      radiusKm: input.radiusKm
    }));
    const last = pageCandidates[pageCandidates.length - 1] ?? null;

    return {
      apiVersion: "v1",
      radiusKm: input.radiusKm,
      items,
      pageInfo: {
        limit: input.limit,
        hasNextPage,
        nextCursor: hasNextPage && last
          ? this.cursor.sign({
              grid: input.grid,
              radiusKm: input.radiusKm,
              distanceMeters: numberFromDb(last.distance_meters) ?? 0,
              id: last.id,
              originKey: input.originKey,
              sessionHash: input.sessionHash
            })
          : null
      }
    };
  }

  private async loadNearbyFromReadModel(input: {
    coordinates: GeoCoordinates;
    grid: GeoGrid;
    limit: number;
    cursorState: VerifiedGeoCursor | null;
    sessionHash: string | null;
    originKey: string | null;
    radiusKm: number;
    useCellBuffer: boolean;
    timing: GeoTiming;
  }): Promise<GeoNearbyResponse> {
    const queryStarted = process.hrtime.bigint();
    const rows = await this.queryReadModelCards(
      input.coordinates,
      input.limit,
      input.cursorState,
      input.radiusKm,
      input.useCellBuffer
    );
    this.observability.observeGeoQuery(durationMs(queryStarted));
    input.timing.mark("geo-read-model");

    const hasNextPage = rows.length > input.limit;
    const pageRows = rows.slice(0, input.limit);
    const items = pageRows.map((row) => {
      const distanceMeters = Math.max(0, Math.round(numberFromDb(row.distance_meters) ?? 0));
      return {
        ...mapReadModelRowToShopDto(row),
        distance: formatApproximateDistance(distanceMeters),
        distanceMeters,
        distanceAccuracyMeters: null,
        distanceSource: "straight_line" as const
      };
    });
    if (rows.length === 0) {
      this.observability.recordGeoFilterRejection("radius", input.radiusKm);
    }
    input.timing.mark("geo-hydrate");
    const last = pageRows[pageRows.length - 1] ?? null;

    return {
      apiVersion: "v1",
      radiusKm: input.radiusKm,
      items,
      pageInfo: {
        limit: input.limit,
        hasNextPage,
        nextCursor: hasNextPage && last
          ? this.cursor.sign({
              grid: input.grid,
              radiusKm: input.radiusKm,
              distanceMeters: numberFromDb(last.distance_meters) ?? 0,
              id: last.store_id,
              originKey: input.originKey,
              sessionHash: input.sessionHash
            })
          : null
      }
    };
  }

  private queryCandidates(
    coordinates: GeoCoordinates,
    limit: number,
    cursorState: VerifiedGeoCursor | null,
    radiusKm: number,
    useCellBuffer: boolean
  ): Promise<GeoCandidateRow[]> {
    const cursorDistance = cursorState?.distanceMeters ?? null;
    const cursorId = cursorState?.id ?? "00000000-0000-4000-8000-000000000000";
    const searchRadiusMeters = radiusMeters(radiusKm) + (useCellBuffer ? GEO_GRID_CELL_BUFFER_METERS : 0);
    return this.prisma.$queryRaw<GeoCandidateRow[]>(Prisma.sql`
      WITH origin AS (
        SELECT ST_SetSRID(ST_MakePoint(${coordinates.longitude}, ${coordinates.latitude}), 4326)::geography AS point
      ),
      candidates AS MATERIALIZED (
        SELECT s."id",
               s."delivery_radius_km",
               COALESCE(s."merchant_rating", 0) * 20 AS rating_score,
               LEAST(100, GREATEST(0, COALESCE(s."order_volume_score", 0))) AS order_volume_score,
               LEAST(100, GREATEST(0, COALESCE(s."conversion_score", 0))) AS conversion_score,
               ST_Distance(s."location", o."point") AS distance_meters
        FROM "stores" s
        CROSS JOIN origin o
        WHERE s."status" = ${StoreStatus.APPROVED}::"StoreStatus"
          AND s."deleted_at" IS NULL
          AND s."inactive" = false
          AND s."is_closed" = false
          AND s."is_banned" = false
          AND s."out_of_service" = false
          AND s."location" IS NOT NULL
          AND ST_DWithin(s."location", o."point", ${searchRadiusMeters}::double precision)
      )
      SELECT "id", distance_meters
      FROM candidates
      WHERE ("delivery_radius_km" IS NULL OR ("delivery_radius_km"::double precision * 1000) >= distance_meters)
        AND (
          ${cursorDistance}::double precision IS NULL
          OR (distance_meters, "id") > (${cursorDistance}::double precision, ${cursorId}::uuid)
        )
      ORDER BY
        distance_meters ASC,
        (
          ((100 - LEAST(distance_meters / 1000, 100)) * 0.70) +
          (rating_score * 0.15) +
          (order_volume_score * 0.10) +
          (conversion_score * 0.05)
        ) DESC,
        "id" ASC
      LIMIT ${limit + 1}
    `);
  }

  private queryReadModelCards(
    coordinates: GeoCoordinates,
    limit: number,
    cursorState: VerifiedGeoCursor | null,
    radiusKm: number,
    useCellBuffer: boolean
  ): Promise<GeoDiscoveryCardRow[]> {
    const cursorDistance = cursorState?.distanceMeters ?? null;
    const cursorId = cursorState?.id ?? "00000000-0000-4000-8000-000000000000";
    const searchRadiusMeters = radiusMeters(radiusKm) + (useCellBuffer ? GEO_GRID_CELL_BUFFER_METERS : 0);
    return this.prisma.$queryRaw<GeoDiscoveryCardRow[]>(Prisma.sql`
      WITH origin AS (
        SELECT ST_SetSRID(ST_MakePoint(${coordinates.longitude}, ${coordinates.latitude}), 4326)::geography AS point
      ),
      candidates AS MATERIALIZED (
        SELECT
          c."store_id",
          c."public_code",
          c."public_slug",
          c."name",
          c."slug",
          c."type",
          c."type_name",
          c."lat",
          c."lng",
          c."delivery_time",
          c."delivery_fee",
          c."image_url",
          c."logo_url",
          c."banner_url",
          c."featured_product",
          c."branding_json",
          c."business_hours_json",
          c."delivery_radius_km",
          COALESCE(c."merchant_rating", 0) * 20 AS rating_score,
          LEAST(100, GREATEST(0, COALESCE(c."order_volume_score", 0))) AS order_volume_score,
          LEAST(100, GREATEST(0, COALESCE(c."conversion_score", 0))) AS conversion_score,
          ST_Distance(c."location", o."point") AS distance_meters
        FROM "shop_discovery_cards" c
        CROSS JOIN origin o
        WHERE c."location" IS NOT NULL
          AND ST_DWithin(c."location", o."point", ${searchRadiusMeters}::double precision)
      )
      SELECT *
      FROM candidates
      WHERE ("delivery_radius_km" IS NULL OR ("delivery_radius_km"::double precision * 1000) >= distance_meters)
        AND (
          ${cursorDistance}::double precision IS NULL
          OR (distance_meters, "store_id") > (${cursorDistance}::double precision, ${cursorId}::uuid)
        )
      ORDER BY
        distance_meters ASC,
        (
          ((100 - LEAST(distance_meters / 1000, 100)) * 0.70) +
          (rating_score * 0.15) +
          (order_volume_score * 0.10) +
          (conversion_score * 0.05)
        ) DESC,
        "store_id" ASC
      LIMIT ${limit + 1}
    `);
  }

  private refreshCachedNearby(input: {
    cacheKey: string;
    coordinates: GeoCoordinates;
    cursorState: VerifiedGeoCursor | null;
    epoch: Awaited<ReturnType<GeoDiscoveryCacheService["getEpochContext"]>>;
    grid: GeoGrid;
    limit: number;
    originKey: string | null;
    radiusKm: number;
    sessionHash: string | null;
    useCellBuffer: boolean;
  }): void {
    void (async () => {
      const lockAcquired = await this.cache.acquireLoadLock(input.cacheKey);
      if (!lockAcquired) {
        return;
      }
      try {
        const data = await this.loadNearby({
          coordinates: input.coordinates,
          cursorState: input.cursorState,
          grid: input.grid,
          limit: input.limit,
          originKey: input.originKey,
          radiusKm: input.radiusKm,
          sessionHash: input.sessionHash,
          timing: new GeoTiming(),
          useCellBuffer: input.useCellBuffer
        });
        await this.cache.setIfEpochUnchanged(
          input.cacheKey,
          input.epoch,
          JSON.stringify({ version: 1, cachedAt: Date.now(), data } satisfies NearbyCacheEnvelope),
          { staleWhileRevalidate: true }
        );
      } catch (error) {
        this.logger.warn(JSON.stringify({
          event: "geo_swr_refresh_failed",
          message: error instanceof Error ? error.message : String(error),
          radiusKm: input.radiusKm,
          grid: input.grid
        }));
      } finally {
        await this.cache.releaseLoadLock(input.cacheKey);
      }
    })();
  }

  private async fetchStoreCards(ids: string[]): Promise<Map<string, NearbyStoreCard>> {
    const cards = new Map<string, NearbyStoreCard>();
    if (!ids.length) {
      this.observability.observeStoreCardCacheHitRatio(1);
      return cards;
    }
    const cached = await this.cache.getStoreCards(ids);
    const missing: string[] = [];
    let cacheHits = 0;
    for (const id of ids) {
      const card = parseStoreCard(cached.get(id) ?? null);
      if (card) {
        cacheHits += 1;
        cards.set(id, card);
      } else {
        missing.push(id);
      }
    }
    this.observability.observeStoreCardCacheHitRatio(cacheHits / ids.length);
    if (!missing.length) {
      return cards;
    }

    const stores = await this.prisma.store.findMany({
      where: {
        id: { in: missing },
        status: StoreStatus.APPROVED,
        deletedAt: null,
        inactive: false,
        isBanned: false,
        isClosed: false,
        outOfService: false
      },
      select: nearbyStoreSelect
    });
    await Promise.all(stores.map(async (store) => {
      const card = mapStoreToShopDto(store);
      cards.set(store.id, card);
      await this.cache.setStoreCard(store.id, JSON.stringify({ version: 1, card } satisfies StoreCardEnvelope));
    }));
    return cards;
  }

  private recordNearbyResponse(
    data: GeoNearbyResponse,
    grid: GeoGrid,
    cacheSource: "l1" | "l2" | "miss",
    durationMs: number
  ): void {
    const returnedCount = data.items.length;
    this.observability.observeShopsReturned("nearby", returnedCount);
    this.observability.recordGeoSearchRadiusUsed(data.radiusKm, returnedCount);
    for (const item of data.items) {
      if (item.distanceMeters != null) {
        this.observability.observeGeoResultDistance(data.radiusKm, item.distanceMeters);
      }
    }
    this.logger.debug(JSON.stringify({
      cacheSource,
      durationMs,
      event: "geo_shop_result",
      grid,
      hasNextPage: data.pageInfo.hasNextPage,
      radiusKm: data.radiusKm,
      returnedCount
    }));
    if (returnedCount > 0) {
      return;
    }

    // Fire-and-forget the observability check so it doesn't block the hot path.
    // The DB count can be slow, and returning a cached 0-result should be < 50ms.
    void this.approvedShopsExist()
      .then((approvedAvailable) => {
        this.observability.recordEmptyShopResult({
          approvedAvailable,
          radiusKm: data.radiusKm,
          source: "nearby"
        });
        this.logger.warn(JSON.stringify({
          approvedAvailable,
          cacheSource,
          durationMs,
          event: "geo_empty_shop_result",
          grid,
          pageInfo: data.pageInfo,
          radiusKm: data.radiusKm
        }));
      })
      .catch((error) => {
        this.logger.error("Failed to record empty shop result observability", error);
      });
  }

  private async approvedShopsExist(): Promise<boolean> {
    const count = await this.prisma.store.count({
      where: {
        status: StoreStatus.APPROVED,
        deletedAt: null,
        inactive: false,
        isBanned: false,
        isClosed: false,
        outOfService: false
      }
    });
    this.observability.setApprovedShopsAvailable(count);
    return count > 0;
  }
}

const nearbyStoreSelect = {
  id: true,
  name: true,
  slug: true,
  publicCode: true,
  addressLine: true,
  latitude: true,
  longitude: true,
  isDeliveryAvailable: true,
  openingTime: true,
  closingTime: true,
  imageUrl: true,
  businessProfile: {
    select: {
      category: true
    }
  },
  branding: {
    select: {
      tagline: true,
      description: true,
      primaryColor: true,
      accentColor: true,
      logoMedia: {
        select: {
          url: true
        }
      },
      bannerMedia: {
        select: {
          url: true
        }
      }
    }
  },
  settings: {
    select: {
      businessHours: true
    }
  },
  products: {
    where: {
      isActive: true,
      status: ProductStatus.PUBLISHED
    },
    orderBy: {
      updatedAt: "desc"
    },
    take: 1,
    select: {
      name: true
    }
  }
} satisfies Prisma.StoreSelect;

type NearbyStoreRow = Prisma.StoreGetPayload<{ select: typeof nearbyStoreSelect }>;
type NearbyStoreCard = ShopDto;

interface StoreCardEnvelope {
  version: 1;
  card: NearbyStoreCard;
}

function mapStoreToShopDto(store: NearbyStoreRow): NearbyStoreCard {
  const type = normalizeCategory(store.businessProfile?.category);
  const visual = categoryVisual(type);
  const fingerprint = stableNumber(store.id);
  return {
    id: store.id,
    name: store.name,
    slug: store.slug,
    publicId: store.publicCode ?? publicStoreCode(store.id),
    publicSlug: publicStoreSlug(store.name),
    distance: "Set location",
    rating: (4.5 + (fingerprint % 5) * 0.1).toFixed(1),
    reviews: `${50 + (fingerprint % 250)} reviews`,
    type,
    typeName: formatCategoryName(type),
    deliveryTime: store.isDeliveryAvailable ? "10-20 min" : "Self Pickup",
    deliveryFee: store.isDeliveryAvailable ? "Free" : "No delivery",
    imageBg: visual.imageBg,
    initials: initialsFromName(store.name),
    featuredProduct: store.products[0]?.name ?? "Daily Essentials",
    tags: visual.tags,
    imageUrl: store.imageUrl,
    logoUrl: store.branding?.logoMedia?.url ?? null,
    bannerUrl: store.branding?.bannerMedia?.url ?? null,
    latitude: numberFromDb(store.latitude),
    longitude: numberFromDb(store.longitude),
    distanceSource: "pending",
    distanceMeters: null,
    distanceAccuracyMeters: null,
    durationSeconds: null,
    durationText: null,
    businessHours: store.settings?.businessHours ?? null,
    timezone: "Asia/Kolkata",
    branding: store.branding
      ? {
          tagline: store.branding.tagline,
          description: store.branding.description,
          primaryColor: store.branding.primaryColor,
          accentColor: store.branding.accentColor
        }
      : null
  };
}

function mapReadModelRowToShopDto(row: GeoDiscoveryCardRow): NearbyStoreCard {
  const type = normalizeCategory(row.type);
  const visual = categoryVisual(type);
  const fingerprint = stableNumber(row.store_id);
  const branding = readModelBranding(row.branding_json);
  return {
    id: row.store_id,
    name: row.name,
    slug: row.slug,
    publicId: row.public_code ?? publicStoreCode(row.store_id),
    publicSlug: row.public_slug || publicStoreSlug(row.name),
    distance: "Set location",
    rating: (4.5 + (fingerprint % 5) * 0.1).toFixed(1),
    reviews: `${50 + (fingerprint % 250)} reviews`,
    type,
    typeName: row.type_name || formatCategoryName(type),
    deliveryTime: row.delivery_time,
    deliveryFee: row.delivery_fee,
    imageBg: visual.imageBg,
    initials: initialsFromName(row.name),
    featuredProduct: row.featured_product || "Daily Essentials",
    tags: visual.tags,
    imageUrl: row.image_url,
    logoUrl: row.logo_url,
    bannerUrl: row.banner_url,
    latitude: numberFromDb(row.lat),
    longitude: numberFromDb(row.lng),
    distanceSource: "pending",
    distanceMeters: null,
    distanceAccuracyMeters: null,
    durationSeconds: null,
    durationText: null,
    businessHours: row.business_hours_json ?? null,
    timezone: "Asia/Kolkata",
    branding
  };
}

function readModelBranding(value: Prisma.JsonValue | null): NearbyStoreCard["branding"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  return {
    tagline: stringOrNull(record.tagline),
    description: stringOrNull(record.description),
    primaryColor: stringOrNull(record.primaryColor),
    accentColor: stringOrNull(record.accentColor)
  };
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function isStaleForSwr(envelope: NearbyCacheEnvelope): boolean {
  return Date.now() - envelope.cachedAt > GEO_SWR_FRESH_MS;
}

function parseCacheEnvelope(raw: string | null): NearbyCacheEnvelope | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<NearbyCacheEnvelope>;
    return parsed?.version === 1 && parsed.data?.apiVersion === "v1" ? parsed as NearbyCacheEnvelope : null;
  } catch {
    return null;
  }
}

function parseCacheEnvelopeWithSource(
  lookup: { source: "l1" | "l2"; value: string } | null
): { envelope: NearbyCacheEnvelope; source: "l1" | "l2" } | null {
  const envelope = parseCacheEnvelope(lookup?.value ?? null);
  return envelope && lookup ? { envelope, source: lookup.source } : null;
}

function parseStoreCard(raw: string | null): NearbyStoreCard | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<StoreCardEnvelope>;
    return parsed?.version === 1 && parsed.card?.id ? parsed.card as NearbyStoreCard : null;
  } catch {
    return null;
  }
}

function withCacheMetadata(
  data: GeoNearbyResponse,
  cache: NonNullable<GeoNearbyResponse["cache"]>
): GeoNearbyResponse {
  return {
    ...data,
    cache
  };
}

function sessionHashFor(value: string | null): string | null {
  return value ? createHash("sha256").update(value).digest("hex").slice(0, 16) : null;
}

function coordinatesCacheKey(coordinates: GeoCoordinates): string {
  return `${coordinates.latitude.toFixed(5)}:${coordinates.longitude.toFixed(5)}`;
}

function categoryVisual(type: string) {
  switch (type) {
    case "vegetables":
      return { imageBg: "from-green-500 to-emerald-600", tags: ["Direct Farm", "Fresh Greens", "Eco-friendly"] };
    case "bakery":
      return { imageBg: "from-pink-500 to-rose-500", tags: ["Artisan", "Freshly Baked", "Desserts"] };
    case "dairy":
      return { imageBg: "from-blue-400 to-indigo-500", tags: ["Farm Fresh", "Organic", "A2 Milk"] };
    case "meat":
      return { imageBg: "from-red-400 to-rose-600", tags: ["Premium Cuts", "Fresh Stock", "Same-day"] };
    case "grocery":
    default:
      return { imageBg: "from-emerald-500 to-teal-600", tags: ["Supermarket", "Organic", "Same-day"] };
  }
}

function normalizeCategory(value: string | null | undefined) {
  return value?.trim().toLowerCase().replace(/[\s_]+/g, "-") || "grocery";
}

function formatCategoryName(value: string) {
  return value
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function stableNumber(value: string) {
  return value.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
}

function initialsFromName(value: string) {
  return value
    .split(" ")
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function durationMs(startedAt: bigint): number {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
}

class GeoTiming {
  private readonly startedAt = process.hrtime.bigint();
  private previous = this.startedAt;
  private readonly segments: GeoTimingSegment[] = [];

  mark(name: string): void {
    const now = process.hrtime.bigint();
    this.segments.push({
      name,
      durationMs: Number(now - this.previous) / 1_000_000
    });
    this.previous = now;
  }

  totalMs(): number {
    return durationMs(this.startedAt);
  }

  done(): GeoTimingSegment[] {
    return [
      ...this.segments,
      {
        name: "geo-total",
        durationMs: this.totalMs()
      }
    ];
  }
}
