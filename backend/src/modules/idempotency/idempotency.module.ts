import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { RedisModule } from "../redis/redis.module";
import { IdempotencyService } from "./idempotency.service";

@Module({
  imports: [DatabaseModule, RedisModule],
  providers: [IdempotencyService],
  exports: [IdempotencyService]
})
export class IdempotencyModule {}
