import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { SecurityModule } from "../../security/security.module";
import { AuthModule } from "../auth/auth.module";
import { RbacModule } from "../rbac/rbac.module";
import { UploadsModule } from "../uploads/uploads.module";
import { ProductsController } from "./products.controller";
import { ProductInventoryService } from "./product-inventory.service";
import { ProductsService } from "./products.service";

@Module({
  controllers: [ProductsController],
  imports: [AuthModule, DatabaseModule, RbacModule, SecurityModule, UploadsModule],
  providers: [ProductInventoryService, ProductsService],
  exports: [ProductInventoryService, ProductsService]
})
export class ProductsModule {}
