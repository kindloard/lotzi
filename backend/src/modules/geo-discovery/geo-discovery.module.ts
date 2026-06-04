import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { ObservabilityModule } from "../observability/observability.module";
import { RateLimitModule } from "../rate-limit/rate-limit.module";
import { RedisModule } from "../redis/redis.module";
import { GeoCursorService } from "./geo-cursor.service";
import { GeoDiscoveryCacheService } from "./geo-discovery-cache.service";
import { GeoDiscoveryService } from "./geo-discovery.service";
import { GeoFraudService } from "./geo-fraud.service";
import { GeoLocationWriter } from "./geo-location-writer.service";

@Module({
  imports: [DatabaseModule, ObservabilityModule, RateLimitModule, RedisModule],
  providers: [
    GeoCursorService,
    GeoDiscoveryCacheService,
    GeoDiscoveryService,
    GeoFraudService,
    GeoLocationWriter
  ],
  exports: [
    GeoDiscoveryCacheService,
    GeoDiscoveryService,
    GeoLocationWriter
  ]
})
export class GeoDiscoveryModule {}
