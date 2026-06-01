import { Module } from "@nestjs/common";
import { RedisModule } from "../redis/redis.module";
import { CatalogCacheService } from "./catalog-cache.service";

@Module({
  imports: [RedisModule],
  providers: [CatalogCacheService],
  exports: [CatalogCacheService]
})
export class CatalogCacheModule {}
