import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { SecurityModule } from "../../security/security.module";
import { AuthModule } from "../auth/auth.module";
import { RbacModule } from "../rbac/rbac.module";
import { RedisModule } from "../redis/redis.module";
import { MerchantDashboardController } from "./merchant-dashboard.controller";
import { MerchantDashboardService } from "./merchant-dashboard.service";

@Module({
  imports: [DatabaseModule, SecurityModule, RbacModule, AuthModule, RedisModule],
  controllers: [MerchantDashboardController],
  providers: [MerchantDashboardService],
  exports: [MerchantDashboardService]
})
export class MerchantDashboardModule {}
