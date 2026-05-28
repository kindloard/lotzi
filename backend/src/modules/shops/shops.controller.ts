import { BadRequestException, Controller, Get, Headers, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { ShopsService, type CachedResult } from "./shops.service";

@Controller("v1/shops")
export class ShopsController {
  constructor(private readonly shops: ShopsService) {}

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
}

function setPublicCacheHeaders<T>(
  response: Response,
  result: CachedResult<T>,
  duration: number,
  name: string
) {
  response.setHeader("Cache-Control", "public, max-age=60, s-maxage=300, stale-while-revalidate=300");
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
