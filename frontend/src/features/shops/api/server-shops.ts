import type {
  DealProduct,
  Shop,
  ShopDetail,
  ShopProductDetailResponse,
  ShopProductsFilters,
  ShopProductsResponse,
  ShopProductSort
} from "../shops-api";

const SERVER_FETCH_TIMEOUT_MS = 2_500;
const DEFAULT_CATALOG_LIMIT = 24;

type NextServerFetchInit = RequestInit & {
  next?: {
    revalidate?: number;
  };
};

export class ShopPageFetchError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

export async function getShopsForLanding(): Promise<Shop[]> {
  return serverFetchJson<Shop[]>("/v1/shops", []);
}

export async function getDealProductsForLanding(): Promise<DealProduct[]> {
  return serverFetchJson<DealProduct[]>("/v1/shops/products", []);
}

export async function getShopDetailForPage(publicId: string, publicSlug: string): Promise<ShopDetail> {
  return serverFetchRequired<ShopDetail>(`/v1/shops/${encodeURIComponent(publicId)}/${encodeURIComponent(publicSlug)}`, {
    next: { revalidate: 300 }
  });
}

export async function getLegacyShopDetailForRedirect(slug: string): Promise<ShopDetail> {
  return serverFetchRequired<ShopDetail>(`/v1/shops/${encodeURIComponent(slug)}`, {
    next: { revalidate: 300 }
  });
}

export async function getShopProductsForPage(
  publicId: string,
  publicSlug: string,
  filters: Partial<ShopProductsFilters>
): Promise<{ data: ShopProductsResponse; failed: boolean }> {
  const normalized = normalizeProductFilters(filters);
  try {
    return {
      data: await serverFetchRequired<ShopProductsResponse>(
        `/v1/shops/${encodeURIComponent(publicId)}/${encodeURIComponent(publicSlug)}/products${filtersToSearch(normalized)}`,
        { next: { revalidate: 300 } }
      ),
      failed: false
    };
  } catch {
    return {
      data: emptyProductsResponse(publicId, publicSlug, normalized),
      failed: true
    };
  }
}

export async function getShopProductDetailForPage(
  publicId: string,
  publicSlug: string,
  productRef: string
): Promise<ShopProductDetailResponse> {
  return serverFetchRequired<ShopProductDetailResponse>(
    `/v1/shops/${encodeURIComponent(publicId)}/${encodeURIComponent(publicSlug)}/products/${encodeURIComponent(productRef)}`,
    { next: { revalidate: 120 } }
  );
}

export async function getProductRouteForShortLink(productPublicId: string) {
  return serverFetchRequired<{
    productPublicId: string;
    productSlug: string;
    publicId: string;
    publicSlug: string;
    productRef: string;
    canonicalPath: string;
  }>(`/v1/products/${encodeURIComponent(productPublicId)}/route`, {
    next: { revalidate: 120 }
  });
}

async function serverFetchJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const response = await fetch(apiUrl(path), {
      cache: "no-store",
      headers: {
        accept: "application/json"
      },
      signal: AbortSignal.timeout(SERVER_FETCH_TIMEOUT_MS)
    });

    if (!response.ok) {
      return fallback;
    }

    return (await response.json()) as T;
  } catch {
    return fallback;
  }
}

async function serverFetchRequired<T>(path: string, init?: NextServerFetchInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(apiUrl(path), {
      ...init,
      headers: {
        accept: "application/json",
        ...Object.fromEntries(new Headers(init?.headers))
      },
      signal: AbortSignal.timeout(SERVER_FETCH_TIMEOUT_MS)
    });
  } catch (error) {
    throw new ShopPageFetchError(503, error instanceof Error ? error.message : "Shop API request failed.");
  }

  if (!response.ok) {
    throw new ShopPageFetchError(response.status, `Shop API request failed: ${response.status}`);
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
    return ensureApiBase(directBackend);
  }

  const publicApiBase = firstConfiguredValue(process.env.NEXT_PUBLIC_API_URL) ?? "/api";
  if (isAbsoluteUrl(publicApiBase)) {
    return ensureApiBase(publicApiBase);
  }

  const frontendOrigin = productionFrontendOrigin();
  if (frontendOrigin) {
    return `${frontendOrigin}${normalizeRelativeBase(publicApiBase)}`;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Shop API URL is not configured for server rendering. Set INTERNAL_API_URL, API_PROXY_URL, BACKEND_URL, or NEXT_PUBLIC_APP_URL."
    );
  }

  return ensureApiBase("http://127.0.0.1:4000");
}

function firstConfiguredValue(...values: Array<string | undefined>) {
  return values.map((value) => value?.trim()).find((value): value is string => Boolean(value));
}

function ensureApiBase(value: string) {
  const base = value.replace(/\/$/, "");
  return base.endsWith("/api") ? base : `${base}/api`;
}

function normalizeRelativeBase(value: string) {
  const base = value.trim() || "/api";
  const withLeadingSlash = base.startsWith("/") ? base : `/${base}`;
  return withLeadingSlash.replace(/\/$/, "") || "/api";
}

function productionFrontendOrigin() {
  if (process.env.NODE_ENV !== "production") {
    return null;
  }

  for (const value of [
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.FRONTEND_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    process.env.VERCEL_URL
  ]) {
    const origin = normalizeOrigin(value);
    if (origin) {
      return origin;
    }
  }

  return null;
}

function normalizeOrigin(value: string | undefined) {
  const raw = value?.trim();
  if (!raw) {
    return null;
  }

  const withProtocol = isAbsoluteUrl(raw) ? raw : `https://${raw}`;
  try {
    return new URL(withProtocol).origin;
  } catch {
    return null;
  }
}

function isAbsoluteUrl(value: string) {
  return /^https?:\/\//i.test(value);
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
