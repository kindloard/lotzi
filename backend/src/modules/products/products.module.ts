import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { SecurityModule } from "../../security/security.module";
import { AuthModule } from "../auth/auth.module";
import { InventoryModule } from "../inventory/inventory.module";
import { RbacModule } from "../rbac/rbac.module";
import { ShopsModule } from "../shops/shops.module";
import { UploadsModule } from "../uploads/uploads.module";
import { ProductsController } from "./products.controller";
import { ProductInventoryService } from "./product-inventory.service";
import { ProductsService } from "./products.service";

@Module({
  controllers: [ProductsController],
  imports: [AuthModule, DatabaseModule, InventoryModule, RbacModule, SecurityModule, ShopsModule, UploadsModule],
  providers: [ProductInventoryService, ProductsService],
  exports: [ProductInventoryService, ProductsService]
})
export class ProductsModule {}
