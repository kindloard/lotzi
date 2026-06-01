import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { GoogleMapsModule } from "../../integrations/google-maps/google-maps.module";
import { CatalogCacheModule } from "../catalog-cache/catalog-cache.module";
import { ObservabilityModule } from "../observability/observability.module";
import { RateLimitModule } from "../rate-limit/rate-limit.module";
import { StoresModule } from "../stores/stores.module";
import { PublicProductsController } from "./public-products.controller";
import { ShopsController } from "./shops.controller";
import { ShopsService } from "./shops.service";

@Module({
  imports: [CatalogCacheModule, DatabaseModule, GoogleMapsModule, ObservabilityModule, RateLimitModule, StoresModule],
  controllers: [ShopsController, PublicProductsController],
  providers: [ShopsService],
  exports: [StoresModule, ShopsService]
})
export class ShopsModule {}
