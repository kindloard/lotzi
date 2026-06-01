import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { CatalogCacheModule } from "../catalog-cache/catalog-cache.module";
import { RedisModule } from "../redis/redis.module";
import { RealtimeModule } from "../realtime/realtime.module";
import { CatalogEventsService } from "./catalog-events.service";

@Module({
  imports: [CatalogCacheModule, DatabaseModule, RedisModule, RealtimeModule],
  providers: [CatalogEventsService],
  exports: [CatalogEventsService]
})
export class CatalogEventsModule {}
