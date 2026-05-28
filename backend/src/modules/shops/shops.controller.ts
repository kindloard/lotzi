import { BadRequestException, Controller, Get, Headers, HttpException, HttpStatus, Logger, Param, Query, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { ObservabilityService } from "../observability/observability.service";
import { RateLimitService } from "../rate-limit/rate-limit.service";
import { ShopsService, type CachedResult, type ShopProductSort, type ShopProductsQuery } from "./shops.service";

const DETAIL_CACHE_CONTROL = "public, max-age=30, s-maxage=60, stale-while-revalidate=30";
const PRODUCTS_CACHE_CONTROL = "public, max-age=60, s-maxage=180, stale-while-revalidate=120";
const PDP_CACHE_CONTROL = "public, max-age=60, s-maxage=180, stale-while-revalidate=120";
const PUBLIC_ID_PATTERN = /^\d{6}$/;
const SHOP_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PRODUCT_REF_PATTERN = /^([0-9a-f]{32})(?:-([a-z0-9]+(?:-[a-z0-9]+)*))?$/i;
const PRODUCT_SORTS = new Set<ShopProductSort>(["relevance", "newest", "price-asc", "price-desc"]);

@Controller("v1/shops")
export class ShopsController {
  private readonly logger = new Logger(ShopsController.name);

  constructor(
    private readonly shops: ShopsService,
    private readonly rateLimit: RateLimitService,
    private readonly observability: ObservabilityService
  ) {}

  @Get()
  async list(
    @Headers("if-none-match") ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) response: Response
  ) {
    const startedAt = process.hrtime.bigint();
    const result = await this.shops.listApprovedShops();
    setPublicCacheHeaders(response, result, durationMs(startedAt), "shops");

    if (etagMatches(ifNoneMatch, result.etag)) {
      response.status(304);
      return undefined;
    }

    return result.data;
  }

  @Get("products")
  async listProducts(
    @Headers("if-none-match") ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) response: Response
  ) {
    const startedAt = process.hrtime.bigint();
    const result = await this.shops.listDealProducts();
    setPublicCacheHeaders(response, result, durationMs(startedAt), "shop-products");

    if (etagMatches(ifNoneMatch, result.etag)) {
      response.status(304);
      return undefined;
    }

    return result.data;
  }

  @Get("distances")
  async listDistances(
    @Query("latitude") latitude: string | undefined,
    @Query("longitude") longitude: string | undefined,
    @Query("accuracy") accuracy: string | undefined,
    @Res({ passthrough: true }) response: Response
  ) {
    const startedAt = process.hrtime.bigint();
    const origin = parseOrigin(latitude, longitude);
    const accuracyMeters = parseOptionalPositiveNumber(accuracy);
    const distances = await this.shops.listShopDistances(origin, accuracyMeters);

    response.setHeader("Cache-Control", "private, max-age=60");
    response.setHeader("Server-Timing", `shop-distances;dur=${durationMs(startedAt).toFixed(1)}`);
    return distances;
  }

  @Get(":publicId/:publicSlug/products")
  async productsForPublicShop(
    @Param("publicId") rawPublicId: string,
    @Param("publicSlug") rawPublicSlug: string,
    @Headers("if-none-match") ifNoneMatch: string | undefined,
    @Query() query: Record<string, unknown>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response
  ) {
    const startedAt = process.hrtime.bigint();
    const publicId = parsePublicId(rawPublicId);
    const publicSlug = parseSlug(rawPublicSlug);
    const filters = parseProductsQuery(query);
    await this.enforcePublicRateLimit("products", request, response, `shop-products:${clientIp(request)}:${publicId}`, 60, 60);

    try {
      const result = await this.shops.listProductsForShopByPublicRoute(publicId, publicSlug, filters);
      const duration = durationMs(startedAt);
      setPublicCacheHeaders(response, result, duration, "shop-products-page", PRODUCTS_CACHE_CONTROL);
      this.observability.observeShopPageProductsReturned(result.data.products.length);

      if (etagMatches(ifNoneMatch, result.etag)) {
        response.status(304);
        this.observability.recordShopPageRequest({
          cache: result.cacheHit ? "hit" : "miss",
          durationMs: duration,
          endpoint: "products",
          status: "304"
        });
        return undefined;
      }

      this.recordShopRequest("products", "200", result.cacheHit, duration);
      return result.data;
    } catch (error) {
      this.recordShopRequest("products", statusForError(error), false, durationMs(startedAt));
      throw error;
    }
  }

  @Get(":publicId/:publicSlug/products/:productRef")
  async productForPublicShop(
    @Param("publicId") rawPublicId: string,
    @Param("publicSlug") rawPublicSlug: string,
    @Param("productRef") rawProductRef: string,
    @Headers("if-none-match") ifNoneMatch: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response
  ) {
    const startedAt = process.hrtime.bigint();
    const publicId = parsePublicId(rawPublicId);
    const publicSlug = parseSlug(rawPublicSlug);
    const productRef = parseProductRef(rawProductRef);
    await this.enforcePublicRateLimit("products", request, response, `shop-pdp:${clientIp(request)}:${publicId}`, 90, 60);

    try {
      const result = await this.shops.getProductDetailForShopByPublicRoute(publicId, publicSlug, productRef.productPublicId);
      const duration = durationMs(startedAt);
      setPublicCacheHeaders(response, result, duration, "shop-pdp-page", PDP_CACHE_CONTROL);

      if (etagMatches(ifNoneMatch, result.etag)) {
        response.status(304);
        this.observability.recordShopPageRequest({
          cache: result.cacheHit ? "hit" : "miss",
          durationMs: duration,
          endpoint: "products",
          status: "304"
        });
        return undefined;
      }

      this.recordShopRequest("products", "200", result.cacheHit, duration);
      return result.data;
    } catch (error) {
      this.recordShopRequest("products", statusForError(error), false, durationMs(startedAt));
      throw error;
    }
  }

  @Get(":publicId/:publicSlug")
  async publicDetail(
    @Param("publicId") rawPublicId: string,
    @Param("publicSlug") rawPublicSlug: string,
    @Headers("if-none-match") ifNoneMatch: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response
  ) {
    const startedAt = process.hrtime.bigint();
    const publicId = parsePublicId(rawPublicId);
    const publicSlug = parseSlug(rawPublicSlug);
    await this.enforcePublicRateLimit("detail", request, response, `shop-detail:${clientIp(request)}:${publicId}`, 120, 60);

    try {
      const result = await this.shops.getShopDetailByPublicRoute(publicId, publicSlug);
      const duration = durationMs(startedAt);
      setPublicCacheHeaders(response, result, duration, "shop-detail", DETAIL_CACHE_CONTROL);

      if (etagMatches(ifNoneMatch, result.etag)) {
        response.status(304);
        this.observability.recordShopPageRequest({
          cache: result.cacheHit ? "hit" : "miss",
          durationMs: duration,
          endpoint: "detail",
          status: "304"
        });
        return undefined;
      }

      this.recordShopRequest("detail", "200", result.cacheHit, duration);
      return result.data;
    } catch (error) {
      this.recordShopRequest("detail", statusForError(error), false, durationMs(startedAt));
      throw error;
    }
  }

  @Get(":slug/products")
  async productsForShop(
    @Param("slug") rawSlug: string,
    @Headers("if-none-match") ifNoneMatch: string | undefined,
    @Query() query: Record<string, unknown>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response
  ) {
    const startedAt = process.hrtime.bigint();
    const slug = parseSlug(rawSlug);
    const filters = parseProductsQuery(query);
    await this.enforcePublicRateLimit("products", request, response, `shop-products:${clientIp(request)}:${slug}`, 60, 60);

    try {
      const result = await this.shops.listProductsForShop(slug, filters);
      const duration = durationMs(startedAt);
      setPublicCacheHeaders(response, result, duration, "shop-products-page", PRODUCTS_CACHE_CONTROL);
      this.observability.observeShopPageProductsReturned(result.data.products.length);

      if (etagMatches(ifNoneMatch, result.etag)) {
        response.status(304);
        this.observability.recordShopPageRequest({
          cache: result.cacheHit ? "hit" : "miss",
          durationMs: duration,
          endpoint: "products",
          status: "304"
        });
        return undefined;
      }

      this.recordShopRequest("products", "200", result.cacheHit, duration);
      return result.data;
    } catch (error) {
      this.recordShopRequest("products", statusForError(error), false, durationMs(startedAt));
      throw error;
    }
  }

  @Get(":slug")
  async detail(
    @Param("slug") rawSlug: string,
    @Headers("if-none-match") ifNoneMatch: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response
  ) {
    const startedAt = process.hrtime.bigint();
    const slug = parseSlug(rawSlug);
    await this.enforcePublicRateLimit("detail", request, response, `shop-detail:${clientIp(request)}`, 120, 60);

    try {
      const result = await this.shops.getShopDetail(slug);
      const duration = durationMs(startedAt);
      setPublicCacheHeaders(response, result, duration, "shop-detail", DETAIL_CACHE_CONTROL);

      if (etagMatches(ifNoneMatch, result.etag)) {
        response.status(304);
        this.observability.recordShopPageRequest({
          cache: result.cacheHit ? "hit" : "miss",
          durationMs: duration,
          endpoint: "detail",
          status: "304"
        });
        return undefined;
      }

      this.recordShopRequest("detail", "200", result.cacheHit, duration);
      return result.data;
    } catch (error) {
      this.recordShopRequest("detail", statusForError(error), false, durationMs(startedAt));
      throw error;
    }
  }

  private async enforcePublicRateLimit(
    endpoint: "detail" | "products",
    request: Request,
    response: Response,
    key: string,
    limit: number,
    windowSeconds: number
  ) {
    const result = await this.rateLimit.consume(key, limit, windowSeconds);
    if (result.allowed) {
      return;
    }
    response.setHeader("Retry-After", String(result.retryAfterSeconds));
    this.observability.recordShopPageRateLimited(endpoint);
    throw new HttpException(
      {
        apiVersion: "v1",
        code: "SHOP_RATE_LIMITED",
        message: "Too many shop requests. Please retry later.",
        retryAfterSeconds: result.retryAfterSeconds
      },
      HttpStatus.TOO_MANY_REQUESTS
    );
  }

  private recordShopRequest(endpoint: "detail" | "products", status: string, cacheHit: boolean, duration: number) {
    if (duration > 750) {
      this.logger.warn(JSON.stringify({
        cache: cacheHit ? "hit" : "miss",
        durationMs: Math.round(duration),
        endpoint,
        event: "shop_page_slow_request",
        status
      }));
    }
    this.observability.recordShopPageRequest({
      cache: cacheHit ? "hit" : "miss",
      durationMs: duration,
      endpoint,
      status
    });
  }
}

function setPublicCacheHeaders<T>(
  response: Response,
  result: CachedResult<T>,
  duration: number,
  name: string,
  cacheControl = "public, max-age=60, s-maxage=300, stale-while-revalidate=300"
) {
  response.setHeader("Cache-Control", cacheControl);
  response.setHeader("ETag", result.etag);
  response.setHeader("Vary", "Accept-Encoding");
  response.setHeader(
    "Server-Timing",
    `${name};dur=${duration.toFixed(1)};desc="${result.cacheHit ? "cache" : "db"}"`
  );
}

function etagMatches(ifNoneMatch: string | undefined, etag: string) {
  return ifNoneMatch
    ?.split(",")
    .map((candidate) => candidate.trim())
    .includes(etag) ?? false;
}

function durationMs(startedAt: bigint) {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
}

function parseOrigin(latitude: string | undefined, longitude: string | undefined) {
  const lat = Number(latitude);
  const lon = Number(longitude);

  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw new BadRequestException("latitude must be a number between -90 and 90.");
  }
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
    throw new BadRequestException("longitude must be a number between -180 and 180.");
  }

  return { latitude: lat, longitude: lon };
}

function parseOptionalPositiveNumber(value: string | undefined) {
  if (value === undefined || value.trim() === "") {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

function parseSlug(value: string) {
  const slug = value.trim();
  if (!slug || slug.length > 96 || !SHOP_SLUG_PATTERN.test(slug)) {
    throw new BadRequestException("slug must be a lowercase URL slug.");
  }
  return slug;
}

function parsePublicId(value: string) {
  const publicId = value.trim();
  if (!PUBLIC_ID_PATTERN.test(publicId)) {
    throw new BadRequestException("public shop id must be a 6 digit number.");
  }
  return publicId;
}

function parseProductsQuery(query: Record<string, unknown>): ShopProductsQuery {
  const q = sanitizeSearch(query.q);
  const category = normalizeOptionalCategory(query.category);
  const includeFacets = parseOptionalBoolean(query.includeFacets, true);
  const rawSort = firstQueryValue(query.sort);
  if (rawSort && !PRODUCT_SORTS.has(rawSort as ShopProductSort)) {
    throw new BadRequestException("sort must be one of relevance, newest, price-asc, or price-desc.");
  }
  const sort = rawSort ? rawSort as ShopProductSort : "relevance";
  const page = parsePositiveInteger(query.page, 1, 1, 10_000);
  const limit = parsePositiveInteger(query.limit, 24, 1, 48);
  return { category, includeFacets, limit, page, q, sort };
}

function parseProductRef(value: string) {
  const normalized = value.trim().toLowerCase();
  const match = normalized.match(PRODUCT_REF_PATTERN);
  if (!match?.[1]) {
    throw new BadRequestException("productRef must be '<productPublicId>-<slug>'.");
  }
  return {
    productPublicId: match[1],
    slug: match[2] ?? null
  };
}

function sanitizeSearch(value: unknown) {
  const raw = firstQueryValue(value);
  return stripControlCharacters(raw ?? "")
    .trim()
    .slice(0, 80);
}

function normalizeOptionalCategory(value: unknown) {
  const raw = firstQueryValue(value);
  if (!raw) {
    return null;
  }
  const normalized = raw.trim();
  if (!normalized || normalized.length > 96) {
    return null;
  }
  return normalized;
}

function parsePositiveInteger(value: unknown, fallback: number, min: number, max: number) {
  const raw = firstQueryValue(value);
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) {
    throw new BadRequestException("pagination values must be integers.");
  }
  return Math.min(Math.max(parsed, min), max);
}

function parseOptionalBoolean(value: unknown, fallback: boolean) {
  const raw = firstQueryValue(value);
  if (!raw) {
    return fallback;
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === "1" || normalized === "true") {
    return true;
  }
  if (normalized === "0" || normalized === "false") {
    return false;
  }
  return fallback;
}

function firstQueryValue(value: unknown) {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "string" ? first : undefined;
}

function stripControlCharacters(value: string) {
  let cleaned = "";
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if ((code >= 0 && code <= 31) || code === 127) {
      continue;
    }
    cleaned += value[index];
  }
  return cleaned;
}

function clientIp(request: Request) {
  const forwarded = request.header("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.ip || request.socket.remoteAddress || "unknown";
}

function statusForError(error: unknown) {
  return error instanceof HttpException ? String(error.getStatus()) : "500";
}
