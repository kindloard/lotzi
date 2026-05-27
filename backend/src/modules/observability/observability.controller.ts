import { Controller, Get, Header, Req, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Request } from "express";
import { ObservabilityService } from "./observability.service";

@Controller("internal")
export class ObservabilityController {
  constructor(
    private readonly observability: ObservabilityService,
    private readonly config: ConfigService
  ) {}

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
