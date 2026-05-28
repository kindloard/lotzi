import { BadRequestException, Body, Controller, Get, Headers, HttpException, HttpStatus, Logger, Param, Post, Query, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { RateLimitService } from "../rate-limit/rate-limit.service";
import { ShopsService } from "./shops.service";

const PRODUCT_PUBLIC_ID_PATTERN = /^[0-9a-f]{32}$/i;

@Controller("v1/products")
export class PublicProductsController {
  private readonly logger = new Logger(PublicProductsController.name);

  constructor(
    private readonly shops: ShopsService,
    private readonly rateLimit: RateLimitService
  ) {}

  @Get(":productPublicId/reviews")
  async reviews(
    @Param("productPublicId") rawProductPublicId: string,
    @Query("cursor") _cursor: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response
  ) {
    const productPublicId = parseProductPublicId(rawProductPublicId);
    await this.enforcePublicRateLimit(request, response, `product-reviews:${clientIp(request)}:${productPublicId}`, 90, 60);

    return {
      apiVersion: "v1",
      productPublicId,
      summary: {
        averageRating: 0,
        totalReviews: 0
      },
      items: [],
      nextCursor: null
    };
  }

  @Get(":productPublicId/route")
  async route(
    @Param("productPublicId") rawProductPublicId: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response
  ) {
    const productPublicId = parseProductPublicId(rawProductPublicId);
    await this.enforcePublicRateLimit(request, response, `product-route:${clientIp(request)}:${productPublicId}`, 120, 60);
    return {
      apiVersion: "v1",
      ...(await this.shops.resolvePublicRouteForProduct(productPublicId))
    };
  }

  @Get(":productPublicId/recommendations")
  async recommendations(
    @Param("productPublicId") rawProductPublicId: string,
    @Query("context") context: string | undefined,
    @Query("limit") limit: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response
  ) {
    const productPublicId = parseProductPublicId(rawProductPublicId);
    await this.enforcePublicRateLimit(request, response, `product-reco:${clientIp(request)}:${productPublicId}`, 120, 60);

    const normalizedContext = context?.trim().toLowerCase() === "global" ? "global" : "shop";
    const parsedLimit = Number(limit);
    const safeLimit = Number.isFinite(parsedLimit) ? Math.min(Math.max(Math.trunc(parsedLimit), 1), 24) : 8;
    const items = await this.shops.listRecommendationsForProduct(productPublicId, normalizedContext, safeLimit);
    return {
      apiVersion: "v1",
      productPublicId,
      context: normalizedContext,
      items
    };
  }

  @Get(":productPublicId/delivery-estimate")
  async deliveryEstimate(
    @Param("productPublicId") rawProductPublicId: string,
    @Query("pincode") pincode: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response
  ) {
    const productPublicId = parseProductPublicId(rawProductPublicId);
    await this.enforcePublicRateLimit(request, response, `product-delivery:${clientIp(request)}:${productPublicId}`, 90, 60);
    const estimate = await this.shops.estimateDeliveryForProduct(productPublicId, pincode ?? null);
    return {
      apiVersion: "v1",
      productPublicId,
      ...estimate
    };
  }

  @Post(":productPublicId/events/view")
  async recordViewEvent(
    @Param("productPublicId") rawProductPublicId: string,
    @Body() body: Record<string, unknown>,
    @Headers("x-device-id") headerDeviceId: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response
  ) {
    const productPublicId = parseProductPublicId(rawProductPublicId);
    await this.enforcePublicRateLimit(request, response, `product-events:${clientIp(request)}:${productPublicId}`, 180, 60);

    const eventId = typeof body.eventId === "string" && body.eventId.trim()
      ? body.eventId.trim().slice(0, 120)
      : `evt_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const deviceId = typeof body.deviceId === "string" && body.deviceId.trim()
      ? body.deviceId.trim().slice(0, 120)
      : headerDeviceId?.trim().slice(0, 120) ?? null;
    const sessionId = typeof body.sessionId === "string" && body.sessionId.trim()
      ? body.sessionId.trim().slice(0, 120)
      : null;
    const viewedAtIso = typeof body.viewedAt === "string" && Number.isFinite(Date.parse(body.viewedAt))
      ? new Date(body.viewedAt).toISOString()
      : new Date().toISOString();

    try {
      const result = await this.shops.recordProductViewEvent({
        productPublicId,
        eventId,
        userId: null,
        deviceId,
        sessionId,
        viewedAtIso
      });
      return {
        apiVersion: "v1",
        productPublicId,
        ...result
      };
    } catch (error) {
      this.logger.warn(`Unable to enqueue product view event: ${error instanceof Error ? error.message : String(error)}`);
      return {
        apiVersion: "v1",
        productPublicId,
        accepted: false
      };
    }
  }

  private async enforcePublicRateLimit(
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
    throw new HttpException(
      {
        apiVersion: "v1",
        code: "PRODUCT_RATE_LIMITED",
        message: "Too many product requests. Please retry later.",
        retryAfterSeconds: result.retryAfterSeconds
      },
      HttpStatus.TOO_MANY_REQUESTS
    );
  }
}

function parseProductPublicId(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!PRODUCT_PUBLIC_ID_PATTERN.test(normalized)) {
    throw new BadRequestException("productPublicId must be a 32-character hex id.");
  }
  return normalized;
}

function clientIp(request: Request) {
  return (
    request.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.ip ||
    request.socket.remoteAddress ||
    "unknown"
  );
}
