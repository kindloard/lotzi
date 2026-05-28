import { Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";
import { Prisma, ProductStatus, StoreStatus } from "@prisma/client";
import { createHash } from "node:crypto";
import { PrismaService } from "../../database/prisma.service";
import { GoogleMapsService, type LatLng } from "../../integrations/google-maps/google-maps.service";
import { RedisService } from "../redis/redis.service";

const SHOP_LIST_CACHE_KEY = "shops:list:v1";
const DEAL_PRODUCTS_CACHE_KEY = "shops:products:v1";
const SHOP_CACHE_TTL_SECONDS = 5 * 60;
const MAX_LANDING_SHOPS = 48;
const MAX_DEAL_PRODUCTS = 8;

export interface ShopDto {
  id: string;
  name: string;
  slug: string;
  distance: string;
  rating: string;
  reviews: string;
  type: string;
  typeName: string;
  deliveryTime: string;
  deliveryFee: string;
  imageBg: string;
  initials: string;
  featuredProduct: string;
  tags: string[];
  imageUrl: string | null;
  logoUrl: string | null;
  bannerUrl: string | null;
  latitude: number | null;
  longitude: number | null;
  distanceSource: "pending" | "straight_line" | "google_road";
  distanceMeters: number | null;
  distanceAccuracyMeters: number | null;
  durationSeconds: number | null;
  durationText: string | null;
  branding: {
    tagline: string | null;
    description: string | null;
    primaryColor: string | null;
    accentColor: string | null;
  } | null;
}

export interface DealProductDto {
  id: string;
  name: string;
  price: number;
  originalPrice: number | null;
  shop: string;
  shopId: string;
  discount: string | null;
  rating: string;
  imageBg: string;
  imageInitials: string;
  imageUrl: string | null;
}

export interface ShopDistanceDto {
  shopId: string;
  distance: string;
  distanceMeters: number;
  distanceAccuracyMeters: number | null;
  distanceSource: "straight_line" | "google_road";
  durationSeconds: number | null;
  durationText: string | null;
}

export interface CachedResult<T> {
  data: T;
  etag: string;
  cacheHit: boolean;
}

interface CacheEnvelope<T> {
  data: T;
  etag: string;
  cachedAt: number;
  version: 1;
}

@Injectable()
export class ShopsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ShopsService.name);
  private readonly inFlightLoads = new Map<string, Promise<CachedResult<unknown>>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly googleMaps: GoogleMapsService,
    private readonly redis: RedisService
  ) {}

  onApplicationBootstrap() {
    void this.prewarmLandingCaches();
  }

  async listApprovedShops(): Promise<CachedResult<ShopDto[]>> {
    return this.cached(SHOP_LIST_CACHE_KEY, () => this.loadApprovedShops());
  }

  async listDealProducts(): Promise<CachedResult<DealProductDto[]>> {
    return this.cached(DEAL_PRODUCTS_CACHE_KEY, () => this.loadDealProducts());
  }

  async listShopDistances(origin: LatLng, accuracyMeters: number | null): Promise<ShopDistanceDto[]> {
    const stores = await this.prisma.store.findMany({
      where: {
        status: StoreStatus.APPROVED,
        deletedAt: null,
        latitude: { not: null },
        longitude: { not: null }
      },
      orderBy: [
        { approvedAt: "desc" },
        { updatedAt: "desc" }
      ],
      take: MAX_LANDING_SHOPS,
      select: {
        id: true,
        latitude: true,
        longitude: true
      }
    });

    const destinations = stores.flatMap((store) => {
      const latitude = decimalToNumber(store.latitude);
      const longitude = decimalToNumber(store.longitude);
      return latitude == null || longitude == null ? [] : [{ latitude, longitude }];
    });

    const routeDistances = await this.googleMaps.drivingDistances(origin, destinations);

    return stores.flatMap<ShopDistanceDto>((store, index) => {
      const latitude = decimalToNumber(store.latitude);
      const longitude = decimalToNumber(store.longitude);
      if (latitude == null || longitude == null) {
        return [];
      }

      const route = routeDistances?.[index] ?? null;
      if (route) {
        const distance: ShopDistanceDto = {
          shopId: store.id,
          distance: formatRouteDistance(route.distanceMeters, route.distanceText),
          distanceMeters: route.distanceMeters,
          distanceAccuracyMeters: accuracyMeters,
          distanceSource: "google_road",
          durationSeconds: route.durationSeconds,
          durationText: route.durationText
        };
        return [distance];
      }

      const distanceMeters = Math.round(distanceInMeters(origin, { latitude, longitude }));
      const distance: ShopDistanceDto = {
        shopId: store.id,
        distance: formatApproximateDistance(distanceMeters, accuracyMeters),
        distanceMeters,
        distanceAccuracyMeters: accuracyMeters,
        distanceSource: "straight_line",
        durationSeconds: null,
        durationText: null
      };
      return [distance];
    });
  }

  async invalidateLandingCaches(): Promise<void> {
    await Promise.all([
      this.redis.del(SHOP_LIST_CACHE_KEY),
      this.redis.del(DEAL_PRODUCTS_CACHE_KEY)
    ]);
  }

  private async prewarmLandingCaches() {
    try {
      await Promise.all([
        this.listApprovedShops(),
        this.listDealProducts()
      ]);
      this.logger.log("Prewarmed shops landing caches.");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Unable to prewarm shops landing caches: ${message}`);
    }
  }

  private async loadApprovedShops(): Promise<ShopDto[]> {
    const stores = await this.prisma.store.findMany({
      where: {
        status: StoreStatus.APPROVED,
        deletedAt: null
      },
      orderBy: [
        { approvedAt: "desc" },
        { updatedAt: "desc" }
      ],
      take: MAX_LANDING_SHOPS,
      select: {
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
      }
    });

    return stores.map((store) => mapStoreToDto(store));
  }

  private async loadDealProducts(): Promise<DealProductDto[]> {
    const products = await this.prisma.product.findMany({
      where: {
        isActive: true,
        status: ProductStatus.PUBLISHED,
        store: {
          status: StoreStatus.APPROVED,
          deletedAt: null
        }
      },
      orderBy: {
        updatedAt: "desc"
      },
      take: MAX_DEAL_PRODUCTS,
      select: {
        id: true,
        name: true,
        price: true,
        compareAtPrice: true,
        imageUrl: true,
        category: {
          select: {
            slug: true
          }
        },
        store: {
          select: {
            id: true,
            name: true
          }
        }
      }
    });

    return products.map((product) => mapProductToDto(product));
  }

  private async cached<T>(key: string, loader: () => Promise<T>): Promise<CachedResult<T>> {
    const cached = await this.readCache<T>(key);
    if (cached) {
      return {
        data: cached.data,
        etag: cached.etag,
        cacheHit: true
      };
    }

    const inFlight = this.inFlightLoads.get(key) as Promise<CachedResult<T>> | undefined;
    if (inFlight) {
      return inFlight;
    }

    const load = this.loadAndCache(key, loader);
    this.inFlightLoads.set(key, load as Promise<CachedResult<unknown>>);
    try {
      return await load;
    } finally {
      this.inFlightLoads.delete(key);
    }
  }

  private async loadAndCache<T>(key: string, loader: () => Promise<T>): Promise<CachedResult<T>> {
    const data = await loader();
    const envelope: CacheEnvelope<T> = {
      data,
      etag: createWeakEtag(data),
      cachedAt: Date.now(),
      version: 1
    };

    await this.redis.setEx(key, SHOP_CACHE_TTL_SECONDS, JSON.stringify(envelope));

    return {
      data,
      etag: envelope.etag,
      cacheHit: false
    };
  }

  private async readCache<T>(key: string): Promise<CacheEnvelope<T> | null> {
    const raw = await this.redis.get(key);
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as Partial<CacheEnvelope<T>>;
      if (!parsed || parsed.version !== 1 || typeof parsed.etag !== "string" || !("data" in parsed)) {
        return null;
      }
      return parsed as CacheEnvelope<T>;
    } catch {
      return null;
    }
  }
}

type StoreLandingRow = Prisma.StoreGetPayload<{
  select: {
    id: true;
    name: true;
    slug: true;
    addressLine: true;
    latitude: true;
    longitude: true;
    isDeliveryAvailable: true;
    imageUrl: true;
    businessProfile: {
      select: {
        category: true;
      };
    };
    branding: {
      select: {
        tagline: true;
        description: true;
        primaryColor: true;
        accentColor: true;
        logoMedia: {
          select: {
            url: true;
          };
        };
        bannerMedia: {
          select: {
            url: true;
          };
        };
      };
    };
    products: {
      select: {
        name: true;
      };
    };
  };
}>;

type DealProductRow = Prisma.ProductGetPayload<{
  select: {
    id: true;
    name: true;
    price: true;
    compareAtPrice: true;
    imageUrl: true;
    category: {
      select: {
        slug: true;
      };
    };
    store: {
      select: {
        id: true;
        name: true;
      };
    };
  };
}>;

function mapStoreToDto(store: StoreLandingRow): ShopDto {
  const type = normalizeCategory(store.businessProfile?.category);
  const visual = categoryVisual(type);
  const fingerprint = stableNumber(store.id);

  return {
    id: store.id,
    name: store.name,
    slug: store.slug,
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
    latitude: decimalToNumber(store.latitude),
    longitude: decimalToNumber(store.longitude),
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

function mapProductToDto(product: DealProductRow): DealProductDto {
  const price = decimalToNumber(product.price) ?? 0;
  const originalPrice = decimalToNumber(product.compareAtPrice);
  const discount =
    originalPrice && originalPrice > price
      ? `${Math.round(((originalPrice - price) / originalPrice) * 100)}% OFF`
      : null;
  const type = normalizeCategory(product.category?.slug);

  return {
    id: product.id,
    name: product.name,
    price,
    originalPrice,
    shop: product.store.name,
    shopId: product.store.id,
    discount,
    rating: (4.5 + (stableNumber(product.id) % 5) * 0.1).toFixed(1),
    imageBg: categoryVisual(type).productBg,
    imageInitials: initialsFromName(product.name),
    imageUrl: product.imageUrl
  };
}

function categoryVisual(type: string) {
  switch (type) {
    case "vegetables":
      return {
        imageBg: "from-green-500 to-emerald-600",
        productBg: "bg-green-50 text-green-800",
        tags: ["Direct Farm", "Fresh Greens", "Eco-friendly"]
      };
    case "bakery":
      return {
        imageBg: "from-pink-500 to-rose-500",
        productBg: "bg-rose-50 text-rose-800",
        tags: ["Artisan", "Freshly Baked", "Desserts"]
      };
    case "dairy":
      return {
        imageBg: "from-blue-400 to-indigo-500",
        productBg: "bg-blue-50 text-blue-800",
        tags: ["Farm Fresh", "Organic", "A2 Milk"]
      };
    case "meat":
      return {
        imageBg: "from-red-400 to-rose-600",
        productBg: "bg-red-50 text-red-800",
        tags: ["Premium Cuts", "Fresh Stock", "Same-day"]
      };
    case "grocery":
    default:
      return {
        imageBg: "from-emerald-500 to-teal-600",
        productBg: "bg-emerald-50 text-emerald-800",
        tags: ["Supermarket", "Organic", "Same-day"]
      };
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

function decimalToNumber(value: Prisma.Decimal | null | undefined) {
  return value == null ? null : Number(value.toString());
}

function createWeakEtag(value: unknown) {
  const hash = createHash("sha1").update(JSON.stringify(value)).digest("hex").slice(0, 32);
  return `W/"${hash}"`;
}

function distanceInMeters(origin: LatLng, destination: LatLng) {
  const radiusMeters = 6_371_000;
  const dLat = toRadians(destination.latitude - origin.latitude);
  const dLon = toRadians(destination.longitude - origin.longitude);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(origin.latitude)) *
      Math.cos(toRadians(destination.latitude)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return radiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatApproximateDistance(distanceMeters: number, accuracyMeters: number | null) {
  const safeDistance = Number.isFinite(distanceMeters) ? Math.max(0, distanceMeters) : 0;
  const accuracy = accuracyMeters && Number.isFinite(accuracyMeters) && accuracyMeters > 0
    ? Math.max(accuracyMeters, 25)
    : 100;

  if (safeDistance <= Math.max(accuracy, 50)) {
    return "Nearby";
  }

  if (safeDistance < 100) {
    return "Within 100 m";
  }

  if (safeDistance < 1_000) {
    const bucket = accuracy > 100 ? 100 : 50;
    const roundedMeters = Math.max(100, Math.round(safeDistance / bucket) * bucket);
    return `About ${roundedMeters} m away`;
  }

  const bucket = safeDistance < 10_000 ? 100 : 1_000;
  const roundedMeters = Math.round(safeDistance / bucket) * bucket;
  const value = roundedMeters < 10_000
    ? (roundedMeters / 1_000).toFixed(1)
    : Math.round(roundedMeters / 1_000).toString();
  return `About ${value} km away`;
}

function formatRouteDistance(distanceMeters: number, fallbackText: string) {
  const safeDistance = Number.isFinite(distanceMeters) ? Math.max(0, distanceMeters) : 0;
  if (safeDistance <= 50) {
    return "Nearby";
  }
  if (safeDistance < 100) {
    return "Within 100 m";
  }
  return fallbackText;
}

function toRadians(value: number) {
  return value * (Math.PI / 180);
}
