import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { SecurityModule } from "../../security/security.module";
import { AuthModule } from "../auth/auth.module";
import { RbacModule } from "../rbac/rbac.module";
import { RedisModule } from "../redis/redis.module";
import { InventoryAdminController } from "./inventory-admin.controller";
import { InventoryController } from "./inventory.controller";
import { InventoryService } from "./inventory.service";

@Module({
  imports: [AuthModule, DatabaseModule, RbacModule, RedisModule, SecurityModule],
  controllers: [InventoryController, InventoryAdminController],
  providers: [InventoryService],
  exports: [InventoryService]
})
export class InventoryModule {}
