import { apiFetch } from "@/lib/api";
import { DEFAULT_NEARBY_RADIUS_KM } from "./lib/geo-grid";

export interface Shop {
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
  distanceMeters: number | null;
  distanceAccuracyMeters: number | null;
  distanceSource: "pending" | "straight_line" | "google_road";
  durationSeconds: number | null;
  durationText: string | null;
  businessHours?: unknown;
  timezone?: string | null;
  branding?: {
    tagline: string | null;
    description: string | null;
    primaryColor: string | null;
    accentColor: string | null;
  } | null;
}

export interface DealProduct {
  id: string;
  variantId: string | null;
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

export type ShopProductSort = "relevance" | "newest" | "price-asc" | "price-desc";

export interface ShopDetail {
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

export type MediaSourceType = "PRODUCT" | "VARIANT";

export interface ShopProductImage {
  id: string;
  url: string;
  altText: string | null;
  width: number | null;
  height: number | null;
  isPrimary: boolean;
  mediaSource?: MediaSourceType;
  variantIds: string[];
  variantSkuIds: string[];
}

export interface ShopProductVariant {
  id: string;
  name: string;
  price: number;
  compareAtPrice: number | null;
  stock: number;
  inStock: boolean;
  unitDisplay: string;
  pricePerBaseUnitDisplay: string;
  isDefault: boolean;
  images: ShopProductImage[];
}

export interface ShopProduct {
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
  images: ShopProductImage[];
  variants: ShopProductVariant[];
}

export interface ShopProductsFilters {
  category: string | null;
  limit: number;
  page: number;
  q: string;
  sort: ShopProductSort;
}

export interface FetchShopCatalogOptions {
  includeFacets?: boolean;
}

export interface ShopProductsResponse {
  store: {
    id: string;
    slug: string;
    publicId: string;
    publicSlug: string;
    name: string;
  };
  products: ShopProduct[];
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
  filters: ShopProductsFilters;
}

export interface ShopProductDetailResponse {
  store: {
    id: string;
    slug: string;
    publicId: string;
    publicSlug: string;
    name: string;
    type: string;
    typeName: string;
    address?: {
      city: string | null;
      state: string | null;
    };
  };
  product: ShopProduct & {
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
    description: string | null;
    imageUrl: string | null;
    price: number;
    compareAtPrice: number | null;
    unitDisplay: string;
    inStock: boolean;
  }>;
}

export interface Coordinates {
  latitude: number;
  longitude: number;
  accuracyMeters?: number | null;
}

export interface ShopDistance {
  shopId: string;
  distance: string;
  distanceMeters: number;
  distanceAccuracyMeters: number | null;
  distanceSource: "straight_line" | "google_road";
  durationSeconds: number | null;
  durationText: string | null;
}

export interface NearbyShopsResponse {
  apiVersion: "v1";
  radiusKm: number;
  items: Shop[];
  pageInfo: {
    limit: number;
    hasNextPage: boolean;
    nextCursor: string | null;
  };
  cache?: {
    ageMs: number;
    grid: {
      latGrid: string;
      lngGrid: string;
    };
    source: "l1" | "l2" | "miss";
  };
}

export function fetchShops(_params?: { latitude?: number; longitude?: number }, init?: RequestInit) {
  return apiFetch<Shop[]>("/v1/shops", init);
}

export function fetchNearbyShops(
  coordinates: Coordinates,
  options: { cursor?: string | null; limit?: number; radiusKm?: number } = {},
  init?: RequestInit
) {
  const params = new URLSearchParams({
    latitude: String(coordinates.latitude),
    longitude: String(coordinates.longitude),
    radiusKm: String(options.radiusKm ?? DEFAULT_NEARBY_RADIUS_KM)
  });
  if (options.limit) {
    params.set("limit", String(options.limit));
  }
  if (options.cursor) {
    params.set("cursor", options.cursor);
  }
  return apiFetch<NearbyShopsResponse>(`/v1/shops/nearby?${params.toString()}`, {
    ...init,
    cache: init?.cache ?? "no-store",
    credentials: init?.credentials ?? "omit"
  });
}

export function fetchShopProducts(init?: RequestInit) {
  return apiFetch<DealProduct[]>("/v1/shops/products", init);
}

export function fetchShopDetail(publicId: string, publicSlug: string, init?: RequestInit) {
  return apiFetch<ShopDetail>(
    `/v1/shops/${encodeURIComponent(publicId)}/${encodeURIComponent(publicSlug)}`,
    init
  );
}

export function fetchShopCatalog(
  publicId: string,
  publicSlug: string,
  filters: Partial<ShopProductsFilters> = {},
  options: FetchShopCatalogOptions = {},
  init?: RequestInit
) {
  const params = new URLSearchParams();
  if (filters.q) {
    params.set("q", filters.q);
  }
  if (filters.category) {
    params.set("category", filters.category);
  }
  if (filters.sort && filters.sort !== "relevance") {
    params.set("sort", filters.sort);
  }
  if (filters.page && filters.page > 1) {
    params.set("page", String(filters.page));
  }
  if (filters.limit && filters.limit !== 24) {
    params.set("limit", String(filters.limit));
  }
  if (options.includeFacets === false) {
    params.set("includeFacets", "0");
  }
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return apiFetch<ShopProductsResponse>(
    `/v1/shops/${encodeURIComponent(publicId)}/${encodeURIComponent(publicSlug)}/products${suffix}`,
    init
  );
}

export function fetchShopProductDetail(
  publicId: string,
  publicSlug: string,
  productRef: string,
  options: { includeRecommendations?: boolean } = {},
  init?: RequestInit
) {
  const params = new URLSearchParams();
  if (options.includeRecommendations === false) {
    params.set("includeRecommendations", "0");
  }
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return apiFetch<ShopProductDetailResponse>(
    `/v1/shops/${encodeURIComponent(publicId)}/${encodeURIComponent(publicSlug)}/products/${encodeURIComponent(productRef)}${suffix}`,
    {
      ...init,
      cache: init?.cache ?? "default",
      credentials: init?.credentials ?? "omit"
    }
  );
}

export function fetchProductRecommendations(
  productPublicId: string,
  options: { context?: "shop" | "global"; limit?: number } = {},
  init?: RequestInit
) {
  const params = new URLSearchParams();
  if (options.context) {
    params.set("context", options.context);
  }
  if (options.limit) {
    params.set("limit", String(options.limit));
  }
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return apiFetch<{ items: ShopProductDetailResponse["recommendations"] }>(
    `/v1/products/${encodeURIComponent(productPublicId)}/recommendations${suffix}`,
    {
      ...init,
      cache: init?.cache ?? "default",
      credentials: init?.credentials ?? "omit"
    }
  );
}

export function fetchProductDeliveryEstimate(productPublicId: string, pincode: string, init?: RequestInit) {
  const params = new URLSearchParams();
  if (pincode.trim()) {
    params.set("pincode", pincode.trim());
  }
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return apiFetch<{
    available: boolean;
    etaMinutes: number | null;
    message: string;
    pincode: string | null;
  }>(
    `/v1/products/${encodeURIComponent(productPublicId)}/delivery-estimate${suffix}`,
    init
  );
}

export function trackProductView(
  productPublicId: string,
  payload: { eventId: string; deviceId?: string; sessionId?: string; viewedAt?: string },
  init?: RequestInit
) {
  return apiFetch<{ accepted: boolean }>(
    `/v1/products/${encodeURIComponent(productPublicId)}/events/view`,
    {
      ...init,
      method: "POST",
      body: JSON.stringify(payload)
    }
  );
}

export function fetchProductRoute(productPublicId: string, init?: RequestInit) {
  return apiFetch<{
    productPublicId: string;
    productSlug: string;
    publicId: string;
    publicSlug: string;
    productRef: string;
    canonicalPath: string;
  }>(
    `/v1/products/${encodeURIComponent(productPublicId)}/route`,
    init
  );
}

export function fetchShopDistances(coordinates: Coordinates, init?: RequestInit) {
  const params = new URLSearchParams({
    latitude: String(coordinates.latitude),
    longitude: String(coordinates.longitude)
  });
  if (coordinates.accuracyMeters != null) {
    params.set("accuracy", String(Math.round(coordinates.accuracyMeters)));
  }

  return apiFetch<ShopDistance[]>(`/v1/shops/distances?${params.toString()}`, init);
}
