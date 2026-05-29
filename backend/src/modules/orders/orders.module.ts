import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { SecurityModule } from "../../security/security.module";
import { AuthModule } from "../auth/auth.module";
import { PaymentsModule } from "../payments/payments.module";
import { RbacModule } from "../rbac/rbac.module";
import { OrdersController } from "./orders.controller";
import { OrdersService } from "./orders.service";

@Module({
  controllers: [OrdersController],
  imports: [AuthModule, DatabaseModule, PaymentsModule, RbacModule, SecurityModule],
  providers: [OrdersService],
  exports: [OrdersService]
})
export class OrdersModule {}
