import { GoneException, Injectable, Logger, NotFoundException, OnApplicationBootstrap } from "@nestjs/common";
import { Prisma, ProductStatus, StoreStatus, UploadRenditionKind } from "@prisma/client";
import { createHash } from "node:crypto";
import { PrismaService } from "../../database/prisma.service";
import { GoogleMapsService, type LatLng } from "../../integrations/google-maps/google-maps.service";
import { ObservabilityService } from "../observability/observability.service";
import { RedisService } from "../redis/redis.service";
import {
  availableStock,
  formatPricePerBaseUnitDisplay,
  formatUnitDisplay
} from "../products/product-measurement";

const SHOP_LIST_CACHE_KEY = "shops:list:v1";
const DEAL_PRODUCTS_CACHE_KEY = "shops:products:v1";
const SHOP_DETAIL_CACHE_PREFIX = "shops:detail:v1:";
const SHOP_PRODUCTS_CACHE_PREFIX = "shops:products:v2:";
const SHOP_PDP_CACHE_PREFIX = "shops:pdp:v1:";
const SHOP_CACHE_TTL_SECONDS = 5 * 60;
const MAX_LANDING_SHOPS = 48;
const MAX_DEAL_PRODUCTS = 8;
const PRODUCT_SORTS = ["relevance", "newest", "price-asc", "price-desc"] as const;
const CATEGORY_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PRODUCT_PUBLIC_ID_PATTERN = /^[0-9a-f]{32}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type ShopProductSort = (typeof PRODUCT_SORTS)[number];

export interface ShopProductsQuery {
  category: string | null;
  includeFacets: boolean;
  limit: number;
  page: number;
  q: string;
  sort: ShopProductSort;
}

export interface ShopDto {
  id: string;
  name: string;
  slug: string;
  publicId: string;
  publicSlug: string;
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

export interface ShopDetailDto {
  id: string;
  slug: string;
  publicId: string;
  publicSlug: string;
  name: string;
  type: string;
  typeName: string;
  description: string | null;
  tagline: string | null;
  phone: string | null;
  address: {
    line: string | null;
    city: string | null;
    state: string | null;
    pincode: string | null;
    latitude: number | null;
    longitude: number | null;
  };
  isDeliveryAvailable: boolean;
  openingTime: string | null;
  closingTime: string | null;
  imageUrl: string | null;
  logoUrl: string | null;
  bannerUrl: string | null;
  tags: string[];
  branding: {
    primaryColor: string | null;
    accentColor: string | null;
  };
}

export interface ShopProductDto {
  id: string;
  publicId: string;
  slug: string;
  name: string;
  category: string;
  categorySlug: string;
  subCategory: string;
  productType: string;
  description: string | null;
  price: number;
  compareAtPrice: number | null;
  stock: number;
  inStock: boolean;
  unitDisplay: string;
  pricePerBaseUnitDisplay: string;
  imageUrl: string | null;
  imageInitials: string;
  images: Array<{
    id: string;
    url: string;
    altText: string | null;
    width: number | null;
    height: number | null;
    isPrimary: boolean;
    variantIds: string[];
    variantSkuIds: string[];
  }>;
  variants: Array<{
    id: string;
    name: string;
    price: number;
    compareAtPrice: number | null;
    stock: number;
    inStock: boolean;
    unitDisplay: string;
    pricePerBaseUnitDisplay: string;
    isDefault: boolean;
  }>;
}

export interface ShopProductsResponseDto {
  store: {
    id: string;
    slug: string;
    publicId: string;
    publicSlug: string;
    name: string;
  };
  products: ShopProductDto[];
  facets: {
    categories: Array<{
      slug: string;
      name: string;
      count: number;
    }>;
    subCategories: Array<{
      name: string;
      count: number;
    }>;
  };
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
  };
  filters: ShopProductsQuery;
}

export interface ShopProductDetailResponseDto {
  store: {
    id: string;
    slug: string;
    publicId: string;
    publicSlug: string;
    name: string;
    type: string;
    typeName: string;
  };
  product: ShopProductDto & {
    publicId: string;
    slug: string;
    canonicalPath: string;
    seoTitle: string;
    seoDescription: string;
    specifications: Array<{
      label: string;
      value: string;
    }>;
    faq: Array<{
      id: string;
      question: string;
      answer: string;
    }>;
  };
  reviewsSummary: {
    averageRating: number;
    totalReviews: number;
  };
  recommendations: Array<{
    id: string;
    publicId: string;
    slug: string;
    name: string;
    imageUrl: string | null;
    price: number;
    compareAtPrice: number | null;
    unitDisplay: string;
    inStock: boolean;
  }>;
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
    private readonly observability: ObservabilityService,
    private readonly redis: RedisService
  ) {}

  onApplicationBootstrap() {
    void this.prewarmLandingCaches();
  }

  async listApprovedShops(): Promise<CachedResult<ShopDto[]>> {
    return this.cached(SHOP_LIST_CACHE_KEY, "landing_shops", SHOP_CACHE_TTL_SECONDS, () => this.loadApprovedShops());
  }

  async listDealProducts(): Promise<CachedResult<DealProductDto[]>> {
    return this.cached(DEAL_PRODUCTS_CACHE_KEY, "landing_products", SHOP_CACHE_TTL_SECONDS, () => this.loadDealProducts());
  }

  async getShopDetail(slug: string): Promise<CachedResult<ShopDetailDto>> {
    const normalizedSlug = normalizeSlugForLookup(slug);
    return this.cached(
      `${SHOP_DETAIL_CACHE_PREFIX}${normalizedSlug}`,
      "shop_detail",
      SHOP_CACHE_TTL_SECONDS,
      () => this.loadShopDetail(normalizedSlug)
    );
  }

  async getShopDetailByPublicRoute(publicId: string, publicSlug: string): Promise<CachedResult<ShopDetailDto>> {
    const normalizedPublicId = normalizePublicStoreCode(publicId);
    const normalizedPublicSlug = normalizeSlugForLookup(publicSlug);
    return this.cached(
      `${SHOP_DETAIL_CACHE_PREFIX}code:${normalizedPublicId}`,
      "shop_detail",
      SHOP_CACHE_TTL_SECONDS,
      () => this.loadShopDetailByPublicRoute(normalizedPublicId, normalizedPublicSlug)
    );
  }

  async listProductsForShop(slug: string, query: ShopProductsQuery): Promise<CachedResult<ShopProductsResponseDto>> {
    const normalizedSlug = normalizeSlugForLookup(slug);
    const canonicalQuery = canonicalShopProductsQuery(query);
    const cacheKey = `${SHOP_PRODUCTS_CACHE_PREFIX}${normalizedSlug}:${hashCanonicalQuery(canonicalQuery)}`;
    return this.cached(
      cacheKey,
      "shop_products",
      SHOP_CACHE_TTL_SECONDS,
      () => this.loadProductsForShop(normalizedSlug, canonicalQuery)
    );
  }

  async listProductsForShopByPublicRoute(
    publicId: string,
    publicSlug: string,
    query: ShopProductsQuery
  ): Promise<CachedResult<ShopProductsResponseDto>> {
    const normalizedPublicId = normalizePublicStoreCode(publicId);
    const normalizedPublicSlug = normalizeSlugForLookup(publicSlug);
    const canonicalQuery = canonicalShopProductsQuery(query);
    const cacheKey = `${SHOP_PRODUCTS_CACHE_PREFIX}code:${normalizedPublicId}:${hashCanonicalQuery(canonicalQuery)}`;
    return this.cached(
      cacheKey,
      "shop_products",
      SHOP_CACHE_TTL_SECONDS,
      () => this.loadProductsForShopByPublicRoute(normalizedPublicId, normalizedPublicSlug, canonicalQuery)
    );
  }

  async getProductDetailForShopByPublicRoute(
    publicId: string,
    publicSlug: string,
    productPublicId: string
  ): Promise<CachedResult<ShopProductDetailResponseDto>> {
    const normalizedPublicId = normalizePublicStoreCode(publicId);
    const normalizedPublicSlug = normalizeSlugForLookup(publicSlug);
    const normalizedProductPublicId = normalizePublicProductCode(productPublicId);
    const cacheKey = `${SHOP_PDP_CACHE_PREFIX}code:${normalizedPublicId}:${normalizedProductPublicId}`;
    return this.cached(
      cacheKey,
      "shop_pdp",
      SHOP_CACHE_TTL_SECONDS,
      () => this.loadProductDetailForShopByPublicRoute(normalizedPublicId, normalizedPublicSlug, normalizedProductPublicId)
    );
  }

  async listRecommendationsForProduct(
    productPublicId: string,
    context: string,
    limit: number
  ): Promise<ShopProductDetailResponseDto["recommendations"]> {
    const productId = productIdFromPublicCode(productPublicId);
    if (!productId) {
      return [];
    }

    const product = await this.prisma.product.findFirst({
      where: {
        id: productId,
        isActive: true,
        status: ProductStatus.PUBLISHED
      },
      select: {
        id: true,
        storeId: true,
        category: {
          select: { slug: true }
        }
      }
    });

    if (!product) {
      return [];
    }

    const records = await this.prisma.product.findMany({
      where: {
        id: { not: product.id },
        storeId: context === "global" ? undefined : product.storeId,
        isActive: true,
        status: ProductStatus.PUBLISHED,
        ...(product.category?.slug ? { category: { slug: product.category.slug } } : {})
      },
      orderBy: [
        { updatedAt: "desc" },
        { id: "asc" }
      ],
      take: Math.min(Math.max(limit, 1), 24),
      select: publicProductSelect
    });

    return records.map((item) => {
      const dto = mapShopProductToDto(item);
      return {
        id: dto.id,
        publicId: dto.publicId,
        slug: dto.slug,
        name: dto.name,
        imageUrl: dto.imageUrl,
        price: dto.price,
        compareAtPrice: dto.compareAtPrice,
        unitDisplay: dto.unitDisplay,
        inStock: dto.inStock
      };
    });
  }

  async resolvePublicRouteForProduct(productPublicId: string) {
    const productId = productIdFromPublicCode(productPublicId);
    if (!productId) {
      throw new NotFoundException("Product was not found.");
    }

    const product = await this.prisma.product.findFirst({
      where: {
        id: productId,
        isActive: true,
        status: ProductStatus.PUBLISHED
      },
      select: {
        id: true,
        name: true,
        store: {
          select: {
            id: true,
            name: true,
            slug: true,
            status: true,
            deletedAt: true
          }
        }
      }
    });

    if (!product || !product.store || product.store.deletedAt || product.store.status !== StoreStatus.APPROVED) {
      throw new NotFoundException("Product was not found.");
    }

    const publicId = publicStoreCode(product.store.id);
    const publicSlug = publicStoreSlug(product.store.name);
    const productSlug = publicProductSlug(product.name);
    const ref = `${publicProductCode(product.id)}-${productSlug}`;
    return {
      productPublicId: publicProductCode(product.id),
      productSlug,
      publicId,
      publicSlug,
      productRef: ref,
      canonicalPath: `/shop/${publicId}/${publicSlug}/product/${ref}`
    };
  }

  async estimateDeliveryForProduct(productPublicId: string, pincode: string | null) {
    const normalizedPincode = pincode?.trim() ?? "";
    const productId = productIdFromPublicCode(productPublicId);
    if (!productId) {
      return {
        available: false,
        etaMinutes: null,
        message: "Enter your pincode to check delivery.",
        pincode: normalizedPincode || null
      };
    }

    const product = await this.prisma.product.findFirst({
      where: {
        id: productId,
        isActive: true,
        status: ProductStatus.PUBLISHED
      },
      select: {
        store: {
          select: {
            isDeliveryAvailable: true
          }
        }
      }
    });

    if (!product?.store?.isDeliveryAvailable) {
      return {
        available: false,
        etaMinutes: null,
        message: "Delivery is unavailable for this product.",
        pincode: normalizedPincode || null
      };
    }

    if (!normalizedPincode) {
      return {
        available: true,
        etaMinutes: null,
        message: "Enter your pincode to check delivery ETA.",
        pincode: null
      };
    }

    return {
      available: true,
      etaMinutes: 20,
      message: "Delivery available in about 20 minutes.",
      pincode: normalizedPincode
    };
  }

  async recordProductViewEvent(input: {
    productPublicId: string;
    eventId: string;
    userId: string | null;
    deviceId: string | null;
    sessionId: string | null;
    viewedAtIso: string;
  }) {
    const payload = {
      ...input,
      tsBucket: input.viewedAtIso.slice(0, 16)
    };
    await this.redis.xAdd("events:pdp:v1", payload, 100_000);
    return { accepted: true };
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
    this.observability.recordShopPageCacheEvent("invalidate", "landing");
  }

  async invalidateShopCaches(input: {
    keyFamily?: "detail" | "products" | "all";
    operation?: string;
    requestId?: string;
    slug?: string | null;
    storeId?: string | null;
  } = {}): Promise<void> {
    const families = input.keyFamily ?? "all";
    let route: PublicStoreRoute | null = null;
    try {
      route = input.slug
        ? { slug: input.slug, publicId: null }
        : await this.routeForStore(input.storeId);
      const deletes: Array<Promise<unknown>> = [
        this.redis.del(SHOP_LIST_CACHE_KEY),
        this.redis.del(DEAL_PRODUCTS_CACHE_KEY)
      ];

      if (route?.slug && (families === "detail" || families === "all")) {
        deletes.push(this.redis.del(`${SHOP_DETAIL_CACHE_PREFIX}${route.slug}`));
      }
      if (route?.slug && (families === "products" || families === "all")) {
        deletes.push(this.redis.delByPrefix(`${SHOP_PRODUCTS_CACHE_PREFIX}${route.slug}:`));
      }
      if (route?.publicId && (families === "detail" || families === "all")) {
        deletes.push(this.redis.del(`${SHOP_DETAIL_CACHE_PREFIX}code:${route.publicId}`));
      }
      if (route?.publicId && (families === "products" || families === "all")) {
        deletes.push(this.redis.delByPrefix(`${SHOP_PRODUCTS_CACHE_PREFIX}code:${route.publicId}:`));
        deletes.push(this.redis.delByPrefix(`${SHOP_PDP_CACHE_PREFIX}code:${route.publicId}:`));
      }

      await Promise.all(deletes);
      this.observability.recordShopPageCacheEvent("invalidate", families);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(JSON.stringify({
        event: "shop_cache_invalidation_failed",
        keyFamily: families,
        operation: input.operation ?? "unknown",
        requestId: input.requestId,
        slug: route?.slug,
        publicId: route?.publicId,
        storeId: input.storeId,
        message
      }));
    }
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

  private async loadShopDetail(slug: string): Promise<ShopDetailDto> {
    const store = await this.prisma.store.findUnique({
      where: { slug },
      select: storeDetailSelect
    });

    return this.toPublicShopDetail(store);
  }

  private async loadShopDetailByPublicRoute(publicId: string, publicSlug: string): Promise<ShopDetailDto> {
    const store = await this.resolveStoreByPublicRoute(publicId, publicSlug);
    return this.toPublicShopDetail(store);
  }

  private async resolveStoreByPublicRoute(publicId: string, publicSlug: string): Promise<StoreDetailRow | null> {
    const stores = await this.prisma.store.findMany({
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        deletedAt: true
      }
    });
    const publicMatches = stores.filter((store) => publicStoreCode(store.id) === publicId);
    const exactSlugMatch = publicMatches.find((store) => publicStoreSlug(store.name) === publicSlug);
    const candidate = exactSlugMatch ?? publicMatches[0];

    if (!candidate) {
      throw new NotFoundException("Shop was not found.");
    }

    return this.prisma.store.findUnique({
      where: { id: candidate.id },
      select: storeDetailSelect
    });
  }

  private toPublicShopDetail(store: StoreDetailRow | null): ShopDetailDto {
    if (!store) {
      throw new NotFoundException("Shop was not found.");
    }
    if (store.deletedAt) {
      throw new GoneException("Shop is no longer available.");
    }
    if (store.status !== StoreStatus.APPROVED) {
      throw new NotFoundException("Shop was not found.");
    }

    return mapStoreDetailToDto(store);
  }

  private async loadProductsForShop(slug: string, query: ShopProductsQuery): Promise<ShopProductsResponseDto> {
    const detail = await this.getShopDetail(slug);
    return this.loadProductsForShopDetail(detail.data, query);
  }

  private async loadProductsForShopByPublicRoute(
    publicId: string,
    publicSlug: string,
    query: ShopProductsQuery
  ): Promise<ShopProductsResponseDto> {
    const detail = await this.getShopDetailByPublicRoute(publicId, publicSlug);
    return this.loadProductsForShopDetail(detail.data, query);
  }

  private async loadProductDetailForShopByPublicRoute(
    publicId: string,
    publicSlug: string,
    productPublicId: string
  ): Promise<ShopProductDetailResponseDto> {
    const detailResult = await this.getShopDetailByPublicRoute(publicId, publicSlug);
    const detail = detailResult.data;
    const productId = productIdFromPublicCode(productPublicId);
    if (!productId) {
      throw new NotFoundException("Product was not found.");
    }

    const product = await this.prisma.product.findFirst({
      where: {
        id: productId,
        storeId: detail.id,
        isActive: true,
        status: ProductStatus.PUBLISHED
      },
      select: publicProductDetailSelect
    });

    if (!product) {
      throw new NotFoundException("Product was not found.");
    }

    const productDto = mapShopProductToDto(product);
    const canonicalSlug = publicProductSlug(product.name);
    const canonicalPath = `/shop/${detail.publicId}/${detail.publicSlug}/product/${publicProductCode(product.id)}-${canonicalSlug}`;
    const recommendations = await this.prisma.product.findMany({
      where: {
        id: { not: product.id },
        storeId: detail.id,
        isActive: true,
        status: ProductStatus.PUBLISHED,
        ...(product.category?.slug ? { category: { slug: product.category.slug } } : {})
      },
      orderBy: [
        { updatedAt: "desc" },
        { id: "asc" }
      ],
      take: 8,
      select: publicProductSelect
    });

    return {
      store: {
        id: detail.id,
        slug: detail.slug,
        publicId: detail.publicId,
        publicSlug: detail.publicSlug,
        name: detail.name,
        type: detail.type,
        typeName: detail.typeName
      },
      product: {
        ...productDto,
        publicId: publicProductCode(product.id),
        slug: canonicalSlug,
        canonicalPath,
        seoTitle: product.seoTitle?.trim() || product.name,
        seoDescription: product.seoDescription?.trim() || product.description || `Shop ${product.name} from ${detail.name}.`,
        specifications: buildProductSpecifications(product),
        faq: []
      },
      reviewsSummary: {
        averageRating: 0,
        totalReviews: 0
      },
      recommendations: recommendations.map((item) => {
        const dto = mapShopProductToDto(item);
        return {
          id: dto.id,
          publicId: publicProductCode(dto.id),
          slug: publicProductSlug(dto.name),
          name: dto.name,
          imageUrl: dto.imageUrl,
          price: dto.price,
          compareAtPrice: dto.compareAtPrice,
          unitDisplay: dto.unitDisplay,
          inStock: dto.inStock
        };
      })
    };
  }

  private async loadProductsForShopDetail(detail: ShopDetailDto, query: ShopProductsQuery): Promise<ShopProductsResponseDto> {
    const where = publicProductWhere(detail.id, query);
    const facetWhere = publicProductWhere(detail.id, { ...query, category: null });
    const orderBy = productOrderBy(query.sort);
    const skip = (query.page - 1) * query.limit;
    const [products, total, facetPayload] = await Promise.all([
      this.prisma.product.findMany({
        where,
        orderBy,
        skip,
        take: query.limit,
        select: publicProductSelect
      }),
      this.prisma.product.count({ where }),
      query.includeFacets
        ? Promise.all([
            this.prisma.product.groupBy({
              by: ["categoryId"],
              where: facetWhere,
              _count: { _all: true }
            }),
            this.prisma.product.groupBy({
              by: ["subCategory"],
              where: facetWhere,
              _count: { _all: true }
            })
          ])
        : Promise.resolve(null)
    ]);

    let facets: ShopProductsResponseDto["facets"] = {
      categories: [],
      subCategories: []
    };

    if (facetPayload) {
      const [categoryGroups, subCategoryGroups] = facetPayload;
      const categoryIds = categoryGroups
        .map((group) => group.categoryId)
        .filter((categoryId): categoryId is string => Boolean(categoryId));
      const categories = categoryIds.length
        ? await this.prisma.category.findMany({
            where: { id: { in: categoryIds } },
            select: { id: true, name: true, slug: true }
          })
        : [];
      const categoryById = new Map(categories.map((category) => [category.id, category]));

      facets = {
        categories: categoryGroups
          .map((group) => {
            const category = group.categoryId ? categoryById.get(group.categoryId) : null;
            return {
              slug: category?.slug ?? "uncategorized",
              name: category?.name ?? "Other",
              count: group._count._all
            };
          })
          .sort((a, b) => a.name.localeCompare(b.name)),
        subCategories: canonicalizeSubCategoryFacets(subCategoryGroups)
      };
    }

    const totalPages = Math.max(1, Math.ceil(total / query.limit));

    return {
      store: {
        id: detail.id,
        slug: detail.slug,
        publicId: detail.publicId,
        publicSlug: detail.publicSlug,
        name: detail.name
      },
      products: products.map(mapShopProductToDto),
      facets,
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages,
        hasNextPage: query.page < totalPages
      },
      filters: query
    };
  }

  private async cached<T>(
    key: string,
    keyFamily: string,
    ttlSeconds: number,
    loader: () => Promise<T>
  ): Promise<CachedResult<T>> {
    const cached = await this.readCache<T>(key);
    if (cached) {
      this.observability.recordShopPageCacheEvent("hit", keyFamily);
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

    this.observability.recordShopPageCacheEvent("miss", keyFamily);
    const load = this.loadAndCache(key, loader, ttlSeconds);
    this.inFlightLoads.set(key, load as Promise<CachedResult<unknown>>);
    try {
      return await load;
    } finally {
      this.inFlightLoads.delete(key);
    }
  }

  private async loadAndCache<T>(key: string, loader: () => Promise<T>, ttlSeconds = SHOP_CACHE_TTL_SECONDS): Promise<CachedResult<T>> {
    const data = await loader();
    const envelope: CacheEnvelope<T> = {
      data,
      etag: createWeakEtag(data),
      cachedAt: Date.now(),
      version: 1
    };

    await this.redis.setEx(key, ttlSeconds, JSON.stringify(envelope));

    return {
      data,
      etag: envelope.etag,
      cacheHit: false
    };
  }

  private async routeForStore(storeId: string | null | undefined): Promise<PublicStoreRoute | null> {
    if (!storeId) {
      return null;
    }
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { id: true, slug: true }
    });
    return store
      ? {
          slug: store.slug,
          publicId: publicStoreCode(store.id)
        }
      : null;
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

const publicProductSelect = {
  id: true,
  name: true,
  subCategory: true,
  productType: true,
  description: true,
  price: true,
  compareAtPrice: true,
  stock: true,
  unitGroup: true,
  quantityValue: true,
  quantityUnit: true,
  packType: true,
  pricePerBaseUnit: true,
  imageUrl: true,
  category: {
    select: {
      name: true,
      slug: true
    }
  },
  images: {
    orderBy: [
      { isPrimary: "desc" as const },
      { sortOrder: "asc" as const }
    ],
    take: 8,
    select: {
      id: true,
      altText: true,
      isPrimary: true,
      sortOrder: true,
      variants: {
        select: {
          productVariant: {
            select: {
              id: true,
              sku: true
            }
          }
        }
      },
      uploadAsset: {
        select: {
          renditions: {
            where: {
              kind: UploadRenditionKind.CARD
            },
            select: {
              secureUrl: true,
              width: true,
              height: true
            },
            take: 1
          }
        }
      }
    }
  },
  variants: {
    orderBy: [
      { isDefault: "desc" as const },
      { position: "asc" as const },
      { createdAt: "asc" as const }
    ],
    select: {
      id: true,
      name: true,
      price: true,
      mrp: true,
      stock: true,
      stockOnHand: true,
      stockReserved: true,
      unitGroup: true,
      quantityValue: true,
      quantityUnit: true,
      packType: true,
      pricePerBaseUnit: true,
      isDefault: true,
      position: true
    }
  }
} satisfies Prisma.ProductSelect;

const publicProductDetailSelect = {
  ...publicProductSelect,
  seoTitle: true,
  seoDescription: true
} satisfies Prisma.ProductSelect;

const storeDetailSelect = {
  id: true,
  slug: true,
  name: true,
  description: true,
  phone: true,
  addressLine: true,
  city: true,
  state: true,
  pincode: true,
  latitude: true,
  longitude: true,
  status: true,
  deletedAt: true,
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
  }
} satisfies Prisma.StoreSelect;

type PublicProductRow = Prisma.ProductGetPayload<{ select: typeof publicProductSelect }>;
type PublicProductDetailRow = Prisma.ProductGetPayload<{ select: typeof publicProductDetailSelect }>;

type StoreDetailRow = Prisma.StoreGetPayload<{ select: typeof storeDetailSelect }>;
type PublicStoreRoute = {
  slug: string | null;
  publicId: string | null;
};

function mapStoreDetailToDto(store: StoreDetailRow): ShopDetailDto {
  const type = normalizeCategory(store.businessProfile?.category);
  const visual = categoryVisual(type);
  return {
    id: store.id,
    slug: store.slug,
    publicId: publicStoreCode(store.id),
    publicSlug: publicStoreSlug(store.name),
    name: store.name,
    type,
    typeName: formatCategoryName(type),
    description: store.branding?.description ?? store.description,
    tagline: store.branding?.tagline ?? null,
    phone: store.phone,
    address: {
      line: store.addressLine,
      city: store.city,
      state: store.state,
      pincode: store.pincode,
      latitude: decimalToNumber(store.latitude),
      longitude: decimalToNumber(store.longitude)
    },
    isDeliveryAvailable: store.isDeliveryAvailable,
    openingTime: store.openingTime,
    closingTime: store.closingTime,
    imageUrl: store.imageUrl,
    logoUrl: store.branding?.logoMedia?.url ?? null,
    bannerUrl: store.branding?.bannerMedia?.url ?? null,
    tags: visual.tags,
    branding: {
      primaryColor: store.branding?.primaryColor ?? null,
      accentColor: store.branding?.accentColor ?? null
    }
  };
}

function mapShopProductToDto(product: PublicProductRow): ShopProductDto {
  const variants = product.variants.map((variant) => {
    const stock = availableStock(variant.stockOnHand, variant.stockReserved);
    const unitDisplay = formatUnitDisplay({
      packType: variant.packType,
      quantityUnit: variant.quantityUnit,
      quantityValue: Number(variant.quantityValue)
    });
    return {
      id: variant.id,
      name: variant.name,
      price: Number(variant.price),
      compareAtPrice: variant.mrp ? Number(variant.mrp) : null,
      stock,
      inStock: stock > 0,
      unitDisplay,
      pricePerBaseUnitDisplay: formatPricePerBaseUnitDisplay(Number(variant.pricePerBaseUnit), variant.unitGroup),
      isDefault: variant.isDefault
    };
  });
  const defaultVariant = variants[0];
  const fallbackStock = product.stock;
  const productUnitDisplay = formatUnitDisplay({
    packType: product.packType,
    quantityUnit: product.quantityUnit,
    quantityValue: Number(product.quantityValue)
  });
  const images = product.images
    .map((image) => {
      const rendition = image.uploadAsset.renditions[0];
      if (!rendition?.secureUrl) {
        return null;
      }
      return {
        id: image.id,
        url: rendition.secureUrl,
        altText: image.altText,
        width: rendition.width,
        height: rendition.height,
        isPrimary: image.isPrimary,
        variantIds: image.variants.map((variant) => variant.productVariant.id),
        variantSkuIds: image.variants
          .map((variant) => variant.productVariant.sku)
          .filter((sku): sku is string => Boolean(sku))
      };
    })
    .filter((image): image is NonNullable<typeof image> => Boolean(image));
  const primaryImage = preferredPublicProductImage(images, defaultVariant?.id);

  return {
    id: product.id,
    publicId: publicProductCode(product.id),
    slug: publicProductSlug(product.name),
    name: product.name,
    category: product.category?.name ?? "Grocery",
    categorySlug: product.category?.slug ?? "grocery",
    subCategory: product.subCategory ?? "",
    productType: product.productType ?? "",
    description: product.description,
    price: defaultVariant?.price ?? Number(product.price),
    compareAtPrice: defaultVariant?.compareAtPrice ?? (product.compareAtPrice ? Number(product.compareAtPrice) : null),
    stock: defaultVariant ? variants.reduce((sum, variant) => sum + variant.stock, 0) : fallbackStock,
    inStock: defaultVariant ? variants.some((variant) => variant.inStock) : fallbackStock > 0,
    unitDisplay: defaultVariant?.unitDisplay ?? productUnitDisplay,
    pricePerBaseUnitDisplay:
      defaultVariant?.pricePerBaseUnitDisplay ??
      formatPricePerBaseUnitDisplay(Number(product.pricePerBaseUnit), product.unitGroup),
    imageUrl: primaryImage?.url ?? product.imageUrl,
    imageInitials: initialsFromName(product.name),
    images,
    variants
  };
}

function preferredPublicProductImage(
  images: ShopProductDto["images"],
  defaultVariantId: string | undefined
) {
  return images.find((image) => image.variantIds.length === 0) ??
    images.find((image) => defaultVariantId && image.variantIds.includes(defaultVariantId)) ??
    images[0];
}

function buildProductSpecifications(product: PublicProductDetailRow) {
  const specifications: Array<{ label: string; value: string }> = [];
  if (product.category?.name) {
    specifications.push({ label: "Category", value: product.category.name });
  }
  if (product.subCategory?.trim()) {
    specifications.push({ label: "Subcategory", value: product.subCategory.trim() });
  }
  if (product.productType?.trim()) {
    specifications.push({ label: "Type", value: product.productType.trim() });
  }
  specifications.push({
    label: "Unit",
    value: formatUnitDisplay({
      packType: product.packType,
      quantityUnit: product.quantityUnit,
      quantityValue: Number(product.quantityValue)
    })
  });
  return specifications;
}

function publicProductWhere(storeId: string, query: ShopProductsQuery): Prisma.ProductWhereInput {
  const and: Prisma.ProductWhereInput[] = [{
    isActive: true,
    status: ProductStatus.PUBLISHED,
    storeId
  }];

  if (query.category) {
    const rawCategory = query.category.trim();
    const isSlug = CATEGORY_SLUG_PATTERN.test(rawCategory);
    if (isSlug) {
      const slugCategory = rawCategory.toLowerCase();
      const deSluggedCategory = deSlugCategory(slugCategory);
      and.push({
        OR: [
          { category: { slug: slugCategory } },
          { subCategory: { equals: rawCategory, mode: "insensitive" } },
          { subCategory: { equals: deSluggedCategory, mode: "insensitive" } }
        ]
      });
    } else {
      and.push({
        subCategory: { equals: rawCategory, mode: "insensitive" }
      });
    }
  }

  if (query.q) {
    and.push({
      OR: [
        { name: { contains: query.q, mode: "insensitive" } },
        { description: { contains: query.q, mode: "insensitive" } },
        { subCategory: { contains: query.q, mode: "insensitive" } },
        { productType: { contains: query.q, mode: "insensitive" } },
        { category: { name: { contains: query.q, mode: "insensitive" } } }
      ]
    });
  }

  return { AND: and };
}

function productOrderBy(sort: ShopProductSort): Prisma.ProductOrderByWithRelationInput[] {
  switch (sort) {
    case "price-asc":
      return [{ price: "asc" }, { updatedAt: "desc" }];
    case "price-desc":
      return [{ price: "desc" }, { updatedAt: "desc" }];
    case "newest":
    case "relevance":
    default:
      return [{ updatedAt: "desc" }, { id: "asc" }];
  }
}

function mapStoreToDto(store: StoreLandingRow): ShopDto {
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

function publicProductCode(productId: string) {
  return productId.replace(/-/g, "").toLowerCase();
}

function productIdFromPublicCode(publicProductId: string) {
  const normalized = normalizePublicProductCode(publicProductId);
  if (!PRODUCT_PUBLIC_ID_PATTERN.test(normalized)) {
    return null;
  }
  return [
    normalized.slice(0, 8),
    normalized.slice(8, 12),
    normalized.slice(12, 16),
    normalized.slice(16, 20),
    normalized.slice(20)
  ].join("-");
}

function publicProductSlug(productName: string) {
  const normalized = productName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
  return normalized || "product";
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

function normalizeSlugForLookup(slug: string) {
  return slug.trim().toLowerCase();
}

function deSlugCategory(slug: string) {
  return slug.replace(/-/g, " ");
}

function canonicalSubCategoryKey(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function canonicalizeSubCategoryFacets(
  groups: Array<{ subCategory: string | null; _count: { _all: number } }>
) {
  const buckets = new Map<string, { total: number; labels: Map<string, number> }>();

  for (const group of groups) {
    const label = group.subCategory?.trim();
    if (!label) {
      continue;
    }
    const canonicalKey = canonicalSubCategoryKey(label);
    if (!canonicalKey) {
      continue;
    }

    const bucket = buckets.get(canonicalKey) ?? { total: 0, labels: new Map<string, number>() };
    bucket.total += group._count._all;
    bucket.labels.set(label, (bucket.labels.get(label) ?? 0) + group._count._all);
    buckets.set(canonicalKey, bucket);
  }

  return Array.from(buckets.values())
    .map((bucket) => {
      const labels = Array.from(bucket.labels.entries()).sort((left, right) => {
        if (right[1] !== left[1]) {
          return right[1] - left[1];
        }
        return left[0].localeCompare(right[0]);
      });
      return {
        name: labels[0]?.[0] ?? "Other",
        count: bucket.total
      };
    })
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }
      return left.name.localeCompare(right.name);
    });
}

function normalizePublicStoreCode(publicId: string) {
  return publicId.trim();
}

function normalizePublicProductCode(publicProductId: string) {
  const normalized = publicProductId.trim().toLowerCase();
  if (PRODUCT_PUBLIC_ID_PATTERN.test(normalized)) {
    return normalized;
  }
  if (UUID_PATTERN.test(normalized)) {
    return normalized.replace(/-/g, "");
  }
  return normalized.replace(/[^a-f0-9]/g, "");
}

function canonicalShopProductsQuery(query: ShopProductsQuery): ShopProductsQuery {
  const category = typeof query.category === "string" ? query.category.trim() : null;
  return {
    category: category || null,
    includeFacets: Boolean(query.includeFacets),
    limit: Math.min(Math.max(Math.trunc(query.limit), 1), 48),
    page: Math.max(Math.trunc(query.page), 1),
    q: query.q.trim(),
    sort: PRODUCT_SORTS.includes(query.sort) ? query.sort : "relevance"
  };
}

function hashCanonicalQuery(query: ShopProductsQuery) {
  const canonical = JSON.stringify({
    category: query.category,
    includeFacets: query.includeFacets,
    limit: query.limit,
    page: query.page,
    q: query.q,
    sort: query.sort
  });
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
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
