import { ForbiddenException, HttpException, HttpStatus, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma, ProductStatus, StoreStatus } from "@prisma/client";
import { createHash } from "node:crypto";
import { PrismaService } from "../../database/prisma.service";
import { ObservabilityService } from "../observability/observability.service";
import { RateLimitService } from "../rate-limit/rate-limit.service";
import type { ShopDto } from "../shops/shops.service";
import { GeoCursorService, type VerifiedGeoCursor } from "./geo-cursor.service";
import { GeoDiscoveryCacheService } from "./geo-discovery-cache.service";
import { GeoFraudService } from "./geo-fraud.service";
import {
  formatApproximateDistance,
  gridForCoordinates,
  numberFromDb,
  parseLatitude,
  parseLimit,
  parseLongitude,
  radiusMeters,
  sleep,
  type GeoCoordinates,
  type GeoGrid
} from "./geo-utils";

interface NearbyInput {
  latitude: unknown;
  longitude: unknown;
  limit: unknown;
  cursor?: string | null;
  ip: string;
  userId?: string | null;
  deviceId?: string | null;
}

interface GeoCandidateRow {
  id: string;
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
}

export interface GeoNearbyResult {
  data: GeoNearbyResponse;
  cacheHit: boolean;
}

@Injectable()
export class GeoDiscoveryService {
  private readonly enabled: boolean;
  private readonly radiusKm: number;

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
    this.radiusKm = config.get<number>("SHOP_DISCOVERY_RADIUS_KM", 5);
  }

  async nearby(input: NearbyInput): Promise<GeoNearbyResult> {
    if (!this.enabled) {
      throw new ServiceUnavailableException({
        apiVersion: "v1",
        code: "SHOP_DISCOVERY_DISABLED",
        message: "Shop discovery is temporarily unavailable."
      });
    }

    const startedAt = process.hrtime.bigint();
    const coordinates = this.parseCoordinates(input.latitude, input.longitude);
    const limit = parseLimit(input.limit);
    const grid = gridForCoordinates(coordinates);
    const sessionHash = sessionHashFor(input.deviceId ?? input.userId ?? null);
    const cursorState = input.cursor
      ? this.cursor.verify(input.cursor, { grid, radiusKm: this.radiusKm, sessionHash })
      : null;

    await this.enforceAbuseControls({ coordinates, grid, input });

    const epoch = await this.cache.getEpochContext(grid, this.radiusKm);
    const cacheKey = this.cache.cacheKey(epoch, this.cache.cursorHash(input.cursor ?? null));
    const cached = parseCacheEnvelope(await this.cache.get(cacheKey));
    if (cached) {
      this.observability.observeGeoSearch("hit", durationMs(startedAt));
      return { data: cached.data, cacheHit: true };
    }

    const lockAcquired = await this.cache.acquireLoadLock(cacheKey);
    if (!lockAcquired) {
      const waitStarted = process.hrtime.bigint();
      await sleep(75);
      this.observability.observeGeoStampedeLockWait(durationMs(waitStarted));
      const warmed = parseCacheEnvelope(await this.cache.get(cacheKey));
      if (warmed) {
        this.observability.observeGeoSearch("hit", durationMs(startedAt));
        return { data: warmed.data, cacheHit: true };
      }
    }

    try {
      const data = await this.loadNearby({ coordinates, grid, limit, cursorState, sessionHash });
      const cachedValue = JSON.stringify({ version: 1, cachedAt: Date.now(), data } satisfies NearbyCacheEnvelope);
      const cacheWritten = await this.cache.setIfEpochUnchanged(cacheKey, epoch, cachedValue);
      if (!cacheWritten) {
        this.observability.recordGeoStaleServe("epoch_conflict");
      }
      this.observability.observeGeoSearch("miss", durationMs(startedAt));
      return { data, cacheHit: false };
    } finally {
      if (lockAcquired) {
        await this.cache.releaseLoadLock(cacheKey);
      }
    }
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
  }): Promise<GeoNearbyResponse> {
    const queryStarted = process.hrtime.bigint();
    const candidates = await this.queryCandidates(input.coordinates, input.limit, input.cursorState);
    this.observability.observeGeoQuery(durationMs(queryStarted));

    const hasNextPage = candidates.length > input.limit;
    const pageCandidates = candidates.slice(0, input.limit);
    const stores = await this.fetchStores(pageCandidates.map((candidate) => candidate.id));
    const storesById = new Map(stores.map((store) => [store.id, store]));
    const items = pageCandidates.flatMap((candidate) => {
      const store = storesById.get(candidate.id);
      if (!store) {
        return [];
      }
      const distanceMeters = Math.max(0, Math.round(numberFromDb(candidate.distance_meters) ?? 0));
      return [{
        ...mapStoreToShopDto(store),
        distance: formatApproximateDistance(distanceMeters),
        distanceMeters,
        distanceAccuracyMeters: null,
        distanceSource: "straight_line" as const
      }];
    });
    const last = pageCandidates[pageCandidates.length - 1] ?? null;

    return {
      apiVersion: "v1",
      radiusKm: this.radiusKm,
      items,
      pageInfo: {
        limit: input.limit,
        hasNextPage,
        nextCursor: hasNextPage && last
          ? this.cursor.sign({
              grid: input.grid,
              radiusKm: this.radiusKm,
              distanceMeters: numberFromDb(last.distance_meters) ?? 0,
              id: last.id,
              sessionHash: input.sessionHash
            })
          : null
      }
    };
  }

  private queryCandidates(
    coordinates: GeoCoordinates,
    limit: number,
    cursorState: VerifiedGeoCursor | null
  ): Promise<GeoCandidateRow[]> {
    const cursorDistance = cursorState?.distanceMeters ?? null;
    const cursorId = cursorState?.id ?? "00000000-0000-4000-8000-000000000000";
    return this.prisma.$queryRaw<GeoCandidateRow[]>(Prisma.sql`
      WITH origin AS (
        SELECT ST_SetSRID(ST_MakePoint(${coordinates.longitude}, ${coordinates.latitude}), 4326)::geography AS point
      ),
      candidates AS MATERIALIZED (
        SELECT s."id",
               ST_Distance(s."location", o."point") AS distance_meters
        FROM "stores" s
        CROSS JOIN origin o
        WHERE s."status" = ${StoreStatus.APPROVED}::"StoreStatus"
          AND s."deleted_at" IS NULL
          AND s."location" IS NOT NULL
          AND ST_DWithin(s."location", o."point", ${radiusMeters(this.radiusKm)}::double precision)
      )
      SELECT "id", distance_meters
      FROM candidates
      WHERE ${cursorDistance}::double precision IS NULL
        OR (distance_meters, "id") > (${cursorDistance}::double precision, ${cursorId}::uuid)
      ORDER BY distance_meters ASC, "id" ASC
      LIMIT ${limit + 1}
    `);
  }

  private fetchStores(ids: string[]): Promise<NearbyStoreRow[]> {
    if (!ids.length) {
      return Promise.resolve([]);
    }
    return this.prisma.store.findMany({
      where: {
        id: { in: ids },
        status: StoreStatus.APPROVED,
        deletedAt: null
      },
      select: nearbyStoreSelect
    });
  }
}

const nearbyStoreSelect = {
  id: true,
  name: true,
  slug: true,
  addressLine: true,
  latitude: true,
  longitude: true,
  isDeliveryAvailable: true,
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

function mapStoreToShopDto(store: NearbyStoreRow): ShopDto {
  const type = normalizeCategory(store.businessProfile?.category);
  const visual = categoryVisual(type);
  const fingerprint = stableNumber(store.id);
  return {
    id: store.id,
    name: store.name,
    slug: store.slug,
    publicId: publicStoreCode(store.id),
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

function sessionHashFor(value: string | null): string | null {
  return value ? createHash("sha256").update(value).digest("hex").slice(0, 16) : null;
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

function publicStoreCode(storeId: string) {
  const hash = createHash("sha256").update(storeId).digest("hex");
  const numeric = BigInt(`0x${hash.slice(0, 12)}`) % 1_000_000n;
  return numeric.toString().padStart(6, "0");
}

function publicStoreSlug(storeName: string) {
  const normalized = storeName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
  return normalized || "store";
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
