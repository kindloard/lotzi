import { Controller, Get, Header, Req, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Request } from "express";
import { PrismaService } from "../../database/prisma.service";
import { RedisService } from "../redis/redis.service";
import { ObservabilityService } from "./observability.service";

@Controller("internal")
export class ObservabilityController {
  constructor(
    private readonly observability: ObservabilityService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService
  ) {}

  @Get("health/db")
  async healthDb() {
    const start = Date.now();
    const healthy = await this.prisma.isHealthy();
    const latencyMs = Date.now() - start;
    return {
      status: healthy ? "ok" : "degraded",
      latencyMs,
      timestamp: new Date().toISOString()
    };
  }

  @Get("health/catalog-cache")
  healthCatalogCache() {
    const configured = this.redis.isConfigured;
    const circuitOpen = this.redis.isCircuitBreakerOpen;
    const healthy = configured && !circuitOpen;
    return {
      status: healthy ? "ok" : "critical",
      redisConfigured: configured,
      redisCircuitOpen: circuitOpen,
      timestamp: new Date().toISOString()
    };
  }

  @Get("metrics")
  @Header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
  metrics(@Req() request: Request) {
    this.assertMetricsAccess(request);
    return this.observability.metrics();
  }

  private assertMetricsAccess(request: Request): void {
    const token = this.config.get<string>("INTERNAL_METRICS_TOKEN");
    if (!token && this.config.get<string>("NODE_ENV") !== "production") {
      return;
    }

    const authorization = request.header("authorization");
    if (!token || authorization !== `Bearer ${token}`) {
      throw new UnauthorizedException("Metrics endpoint requires an internal token.");
    }
  }
}
