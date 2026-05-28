import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { SecurityModule } from "../../security/security.module";
import { RateLimitModule } from "../rate-limit/rate-limit.module";
import { RbacModule } from "../rbac/rbac.module";
import { ShopsModule } from "../shops/shops.module";
import { AdminApprovalsService } from "./admin-approvals.service";
import { AdminAuthGuard } from "./admin-auth.guard";
import { AdminAuthService } from "./admin-auth.service";
import { AdminController } from "./admin.controller";

@Module({
  imports: [DatabaseModule, SecurityModule, RateLimitModule, RbacModule, ShopsModule],
  controllers: [AdminController],
  providers: [AdminApprovalsService, AdminAuthGuard, AdminAuthService]
})
export class AdminModule {}
