import { Module } from "@nestjs/common";
import { CashfreeModule } from "../../integrations/cashfree/cashfree.module";
import { DatabaseModule } from "../../database/database.module";
import { SecurityModule } from "../../security/security.module";
import { AuthModule } from "../auth/auth.module";
import { IdempotencyModule } from "../idempotency/idempotency.module";
import { PaymentsModule } from "../payments/payments.module";
import { RateLimitModule } from "../rate-limit/rate-limit.module";
import { RbacModule } from "../rbac/rbac.module";
import { CheckoutController } from "./checkout.controller";
import { CheckoutService } from "./checkout.service";

@Module({
  imports: [
    AuthModule,
    CashfreeModule,
    DatabaseModule,
    IdempotencyModule,
    PaymentsModule,
    RateLimitModule,
    RbacModule,
    SecurityModule
  ],
  controllers: [CheckoutController],
  providers: [CheckoutService],
  exports: [CheckoutService]
})
export class CheckoutModule {}
