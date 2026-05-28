import { apiFetch } from "@/lib/api";

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
  branding?: {
    tagline: string | null;
    description: string | null;
    primaryColor: string | null;
    accentColor: string | null;
  } | null;
}

export interface DealProduct {
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
  images: Array<{
    id: string;
    url: string;
    altText: string | null;
    width: number | null;
    height: number | null;
    isPrimary: boolean;
  }>;
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

export function fetchShops(_params?: { latitude?: number; longitude?: number }, init?: RequestInit) {
  return apiFetch<Shop[]>("/v1/shops", init);
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
  init?: RequestInit
) {
  return apiFetch<ShopProductDetailResponse>(
    `/v1/shops/${encodeURIComponent(publicId)}/${encodeURIComponent(publicSlug)}/products/${encodeURIComponent(productRef)}`,
    init
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
    init
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

export function enrichShopsWithDistance(shops: Shop[], coordinates: Coordinates | null): Shop[] {
  if (!coordinates) {
    return shops;
  }

  return shops.map((shop) => {
    if (shop.latitude == null || shop.longitude == null) {
      return shop;
    }

    const distanceMeters = distanceInMeters(
      coordinates.latitude,
      coordinates.longitude,
      shop.latitude,
      shop.longitude
    );

    return {
      ...shop,
      distance: formatApproximateDistance(distanceMeters, coordinates.accuracyMeters ?? null),
      distanceMeters,
      distanceAccuracyMeters: coordinates.accuracyMeters ?? null,
      distanceSource: "straight_line"
    };
  });
}

export function mergeShopDistances(shops: Shop[], distances: ShopDistance[] | undefined): Shop[] {
  if (!distances?.length) {
    return shops;
  }

  const byShopId = new Map(distances.map((distance) => [distance.shopId, distance]));
  return shops.map((shop) => {
    const distance = byShopId.get(shop.id);
    return distance
      ? {
          ...shop,
          distance: distance.distance,
          distanceMeters: distance.distanceMeters,
          distanceAccuracyMeters: distance.distanceAccuracyMeters,
          distanceSource: distance.distanceSource,
          durationSeconds: distance.durationSeconds,
          durationText: distance.durationText
        }
      : shop;
  });
}

function distanceInMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const radiusMeters = 6_371_000;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return radiusMeters * c;
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

function toRadians(value: number) {
  return value * (Math.PI / 180);
}
