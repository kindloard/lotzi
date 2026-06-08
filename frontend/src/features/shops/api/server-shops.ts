import { cache } from "react";
import { createHash } from "node:crypto";
import type {
  DealProduct,
  NearbyShopsResponse,
  Shop,
  ShopDetail,
  ShopProductDetailResponse,
  ShopProductsFilters,
  ShopProductsResponse,
  ShopProductSort
} from "../shops-api";
import { parseGeoGridCookie, type InitialNearbyPayload } from "../lib/geo-cookie";
import { DEFAULT_NEARBY_RADIUS_KM } from "../lib/geo-grid";

const REQUIRED_SERVER_FETCH_TIMEOUT_MS = positiveIntegerFromEnv("SHOP_API_FETCH_TIMEOUT_MS", 10_000);
const OPTIONAL_SERVER_FETCH_TIMEOUT_MS = positiveIntegerFromEnv("SHOP_API_OPTIONAL_FETCH_TIMEOUT_MS", 4_000);
const SHOP_LANDING_FETCH_TIMEOUT_MS = positiveIntegerFromEnv("SHOP_LANDING_FETCH_TIMEOUT_MS", 1_500);
const SHOP_CATALOG_SSR_BUDGET_MS = positiveIntegerFromEnv("SHOP_CATALOG_SSR_BUDGET_MS", 120);
const HOME_GEO_SSR_BUDGET_MS = positiveIntegerFromEnv("HOME_GEO_SSR_BUDGET_MS", 120);
const DEFAULT_CATALOG_LIMIT = 24;
const DEFAULT_NEARBY_LIMIT = 24;
const SHOP_DETAIL_REVALIDATE_SECONDS = positiveIntegerFromEnv("SHOP_DETAIL_REVALIDATE_SECONDS", 60 * 60);
const SHOP_CATALOG_REVALIDATE_SECONDS = positiveIntegerFromEnv("SHOP_CATALOG_REVALIDATE_SECONDS", 60);

type NextServerFetchInit = RequestInit & {
  next?: {
    revalidate?: number;
    tags?: string[];
  };
  timeoutMs?: number;
};

export class ShopPageFetchError extends Error {
  readonly retryable: boolean;

  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "ShopPageFetchError";
    this.retryable = status === 408 || status === 429 || status >= 500;
  }
}

export async function getShopsForLanding(): Promise<Shop[]> {
  if (!homeSsrShopsEnabled()) {
    return [];
  }
  return serverFetchJson<Shop[]>("/v1/shops", [], {
    name: "landing_shops",
    timeoutMs: SHOP_LANDING_FETCH_TIMEOUT_MS
  });
}

export async function getNearbyShopsForLandingGeoCookie(
  cookieValue: string | undefined
): Promise<InitialNearbyPayload | null> {
  if (!homeGeoSsrEnabled() || !homeNearbyDehydrationEnabled()) {
    return null;
  }

  const parsed = parseGeoGridCookie(cookieValue);
  if (!parsed) {
    return null;
  }

  const params = new URLSearchParams({
    latGrid: parsed.grid.latGrid,
    lngGrid: parsed.grid.lngGrid,
    limit: String(DEFAULT_NEARBY_LIMIT),
    radiusKm: String(DEFAULT_NEARBY_RADIUS_KM)
  });
  const fetchedAt = Date.now();
  const data = await serverFetchJson<NearbyShopsResponse | null>(
    `/v1/shops/nearby/cell?${params.toString()}`,
    null,
    {
      name: "landing_nearby_cell",
      timeoutMs: HOME_GEO_SSR_BUDGET_MS
    }
  );

  if (!isNearbyResponse(data)) {
    return null;
  }

  return {
    coordinates: parsed.coordinates,
    data,
    fetchedAt,
    grid: parsed.grid,
    radiusKm: DEFAULT_NEARBY_RADIUS_KM
  };
}

export async function getDealProductsForLanding(): Promise<DealProduct[]> {
  return serverFetchJson<DealProduct[]>("/v1/shops/products", []);
}

export const getShopDetailForPage = cache(async function getShopDetailForPage(
  publicId: string,
  publicSlug: string
): Promise<ShopDetail> {
  return serverFetchRequired<ShopDetail>(`/v1/shops/${encodeURIComponent(publicId)}/${encodeURIComponent(publicSlug)}`, {
    next: {
      revalidate: SHOP_DETAIL_REVALIDATE_SECONDS,
      tags: [shopDetailTag(publicId)]
    }
  });
});

export const getLegacyShopDetailForRedirect = cache(async function getLegacyShopDetailForRedirect(slug: string): Promise<ShopDetail> {
  return serverFetchRequired<ShopDetail>(`/v1/shops/${encodeURIComponent(slug)}`, {
    next: {
      revalidate: SHOP_DETAIL_REVALIDATE_SECONDS
    }
  });
});

export async function getShopProductsForPage(
  publicId: string,
  publicSlug: string,
  filters: Partial<ShopProductsFilters>
): Promise<{ data: ShopProductsResponse; failed: boolean }> {
  const normalized = normalizeProductFilters(filters);
  const startedAt = Date.now();
  try {
    return {
      data: await serverFetchRequired<ShopProductsResponse>(
        `/v1/shops/${encodeURIComponent(publicId)}/${encodeURIComponent(publicSlug)}/products${filtersToSearch(normalized)}`,
        {
          next: {
            revalidate: SHOP_CATALOG_REVALIDATE_SECONDS,
            tags: shopCatalogTags(publicId, normalized)
          },
          timeoutMs: shopCatalogSsrBudgetEnabled()
            ? SHOP_CATALOG_SSR_BUDGET_MS
            : undefined
        }
      ),
      failed: false
    };
  } catch (error) {
    if (shopCatalogSsrBudgetEnabled()) {
      logShopCatalogSsrBudgetFallback({
        cause: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startedAt,
        publicId
      });
    }
    return {
      data: emptyProductsResponse(publicId, publicSlug, normalized),
      failed: true
    };
  }
}

export const getShopProductDetailForPage = cache(async function getShopProductDetailForPage(
  publicId: string,
  publicSlug: string,
  productRef: string
): Promise<ShopProductDetailResponse> {
  return serverFetchRequired<ShopProductDetailResponse>(
    `/v1/shops/${encodeURIComponent(publicId)}/${encodeURIComponent(publicSlug)}/products/${encodeURIComponent(productRef)}?includeRecommendations=1`,
    {
      next: {
        revalidate: SHOP_CATALOG_REVALIDATE_SECONDS,
        tags: shopPdpTags(productRef)
      }
    }
  );
});

export const getProductRouteForShortLink = cache(async function getProductRouteForShortLink(productPublicId: string) {
  return serverFetchRequired<{
    productPublicId: string;
    productSlug: string;
    publicId: string;
    publicSlug: string;
    productRef: string;
    canonicalPath: string;
  }>(`/v1/products/${encodeURIComponent(productPublicId)}/route`, {
    cache: "no-store"
  });
});

async function serverFetchJson<T>(
  path: string,
  fallback: T,
  options: { name?: string; timeoutMs?: number } = {}
): Promise<T> {
  const startedAt = Date.now();
  try {
    const response = await fetch(apiUrl(path), {
      cache: "no-store",
      headers: {
        accept: "application/json"
      },
      signal: AbortSignal.timeout(options.timeoutMs ?? OPTIONAL_SERVER_FETCH_TIMEOUT_MS)
    });

    if (!response.ok) {
      logServerFetchFallback({
        durationMs: Date.now() - startedAt,
        fallback,
        name: options.name ?? path,
        path,
        status: response.status
      });
      return fallback;
    }

    return (await response.json()) as T;
  } catch (error) {
    logServerFetchFallback({
      cause: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt,
      fallback,
      name: options.name ?? path,
      path
    });
    return fallback;
  }
}

async function serverFetchRequired<T>(path: string, init?: NextServerFetchInit): Promise<T> {
  let response: Response;
  try {
    const url = apiUrl(path);
    response = await fetch(url, {
      ...init,
      headers: {
        accept: "application/json",
        ...Object.fromEntries(new Headers(init?.headers))
      },
      signal: AbortSignal.timeout(init?.timeoutMs ?? REQUIRED_SERVER_FETCH_TIMEOUT_MS)
    });
  } catch (error) {
    throw new ShopPageFetchError(503, apiUnavailableMessage(error));
  }

  if (!response.ok) {
    throw new ShopPageFetchError(response.status, `Shop API request failed with status ${response.status}.`);
  }

  return (await response.json()) as T;
}

function apiUrl(path: string) {
  return `${serverApiBaseUrl()}${path}`;
}

function serverApiBaseUrl() {
  const directBackend =
    firstConfiguredValue(process.env.INTERNAL_API_URL, process.env.API_PROXY_URL, process.env.BACKEND_URL);
  if (directBackend) {
    return productionSafeApiBase(directBackend);
  }

  const publicApiBase = firstConfiguredValue(process.env.NEXT_PUBLIC_API_URL) ?? "/api";
  if (isAbsoluteUrl(publicApiBase)) {
    return productionSafeApiBase(publicApiBase);
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Shop API URL is not configured for server rendering. Set INTERNAL_API_URL, API_PROXY_URL, BACKEND_URL, or an absolute NEXT_PUBLIC_API_URL."
    );
  }

  return ensureApiBase("http://127.0.0.1:4000");
}

function productionSafeApiBase(value: string) {
  const base = ensureApiBase(value);
  if (process.env.NODE_ENV === "production" && isLoopbackUrl(base)) {
    throw new Error(
      "Shop API URL cannot point to localhost in production. Set INTERNAL_API_URL, API_PROXY_URL, BACKEND_URL, or NEXT_PUBLIC_API_URL to the deployed backend URL."
    );
  }
  return base;
}

function firstConfiguredValue(...values: Array<string | undefined>) {
  return values.map((value) => value?.trim()).find((value): value is string => Boolean(value));
}

function apiUnavailableMessage(error: unknown) {
  if (error instanceof Error && error.name === "TimeoutError") {
    return "Shop API request timed out.";
  }
  if (error instanceof Error && error.message) {
    return `Shop API is unavailable: ${error.message}`;
  }
  return "Shop API is unavailable.";
}

function positiveIntegerFromEnv(key: string, fallback: number) {
  const value = Number(process.env[key]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function booleanFromEnv(key: string, fallback: boolean) {
  const value = process.env[key]?.trim().toLowerCase();
  if (!value) {
    return fallback;
  }
  if (["1", "true", "yes", "on"].includes(value)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(value)) {
    return false;
  }
  return fallback;
}

function homeSsrShopsEnabled() {
  // Rollout guard: SSR inventory is the primary fallback once enabled; disabling preserves the current geo-only path.
  return booleanFromEnv("NEXT_PUBLIC_HOME_SSR_SHOPS_ENABLED", false);
}

function homeGeoSsrEnabled() {
  return booleanFromEnv("HOME_GEO_SSR_ENABLED", false);
}

function homeNearbyDehydrationEnabled() {
  return booleanFromEnv("HOME_NEARBY_DEHYDRATION_ENABLED", false);
}

function shopCatalogSsrBudgetEnabled() {
  return booleanFromEnv("SHOP_CATALOG_SSR_BUDGET_ENABLED", false);
}

function logShopCatalogSsrBudgetFallback(input: {
  cause: string;
  durationMs: number;
  publicId: string;
}) {
  console.warn(JSON.stringify({
    cause: input.cause,
    durationMs: input.durationMs,
    event: "shop_catalog_ssr_budget_exceeded",
    publicId: input.publicId
  }));
}

function logServerFetchFallback(input: {
  cause?: string;
  durationMs: number;
  fallback: unknown;
  name: string;
  path: string;
  status?: number;
}) {
  console.warn(JSON.stringify({
    cause: input.cause ?? null,
    durationMs: input.durationMs,
    endpoint: input.path,
    event: "server_optional_fetch_fallback",
    name: input.name,
    returnedCount: Array.isArray(input.fallback) ? input.fallback.length : null,
    status: input.status ?? null
  }));
}

function isNearbyResponse(value: NearbyShopsResponse | null): value is NearbyShopsResponse {
  return Boolean(
    value &&
    value.apiVersion === "v1" &&
    Array.isArray(value.items) &&
    value.pageInfo &&
    Number.isFinite(value.radiusKm)
  );
}

function ensureApiBase(value: string) {
  const base = value.replace(/\/$/, "");
  return base.endsWith("/api") ? base : `${base}/api`;
}

function isAbsoluteUrl(value: string) {
  return /^https?:\/\//i.test(value);
}

function isLoopbackUrl(value: string) {
  try {
    const hostname = new URL(value).hostname;
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

export function normalizeProductFilters(filters: Partial<ShopProductsFilters> = {}): ShopProductsFilters {
  return {
    category: normalizeCategory(filters.category),
    limit: clampInteger(filters.limit, DEFAULT_CATALOG_LIMIT, 1, 48),
    page: clampInteger(filters.page, 1, 1, 10_000),
    q: sanitizeSearch(filters.q),
    sort: normalizeSort(filters.sort)
  };
}

function filtersToSearch(filters: ShopProductsFilters) {
  const params = new URLSearchParams();
  if (filters.q) {
    params.set("q", filters.q);
  }
  if (filters.category) {
    params.set("category", filters.category);
  }
  if (filters.sort !== "relevance") {
    params.set("sort", filters.sort);
  }
  if (filters.page > 1) {
    params.set("page", String(filters.page));
  }
  if (filters.limit !== DEFAULT_CATALOG_LIMIT) {
    params.set("limit", String(filters.limit));
  }
  return params.toString() ? `?${params.toString()}` : "";
}

function shopDetailTag(publicId: string) {
  return `shop-detail:${publicId}`;
}

function shopCatalogTags(publicId: string, filters: ShopProductsFilters) {
  return [
    `shop-catalog:${publicId}`,
    `shop-catalog:${publicId}:${hashCatalogFilters(filters)}`
  ];
}

function shopPdpTags(productRef: string) {
  const productPublicId = productPublicIdFromRef(productRef);
  return productPublicId ? [`shop-pdp:${productPublicId}`] : [];
}

function productPublicIdFromRef(productRef: string) {
  const normalized = productRef.trim().toLowerCase();
  const match = normalized.match(/^([0-9a-f]{32})(?:-|$)/);
  return match?.[1] ?? null;
}

function hashCatalogFilters(filters: ShopProductsFilters) {
  return createHash("sha256")
    .update(JSON.stringify({
      category: filters.category,
      limit: filters.limit,
      page: filters.page,
      q: filters.q,
      sort: filters.sort
    }))
    .digest("hex")
    .slice(0, 16);
}

function emptyProductsResponse(publicId: string, publicSlug: string, filters: ShopProductsFilters): ShopProductsResponse {
  return {
    store: {
      id: "",
      slug: publicSlug,
      publicId,
      publicSlug,
      name: ""
    },
    products: [],
    facets: {
      categories: [],
      subCategories: []
    },
    pagination: {
      page: filters.page,
      limit: filters.limit,
      total: 0,
      totalPages: 1,
      hasNextPage: false
    },
    filters
  };
}

function sanitizeSearch(value: unknown) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, 80)
    : "";
}

function normalizeCategory(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized && normalized.length <= 96 ? normalized : null;
}

function normalizeSort(value: unknown): ShopProductSort {
  return value === "newest" || value === "price-asc" || value === "price-desc" || value === "relevance"
    ? value
    : "relevance";
}

function clampInteger(value: unknown, fallback: number, min: number, max: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}
