import { Module } from "@nestjs/common";
import { CashfreeModule } from "../../integrations/cashfree/cashfree.module";
import { DatabaseModule } from "../../database/database.module";
import { SecurityModule } from "../../security/security.module";
import { AuthModule } from "../auth/auth.module";
import { IdempotencyModule } from "../idempotency/idempotency.module";
import { InventoryModule } from "../inventory/inventory.module";
import { RateLimitModule } from "../rate-limit/rate-limit.module";
import { RbacModule } from "../rbac/rbac.module";
import { PaymentTransitionService } from "./payment-transition.service";
import { PaymentWorkersService } from "./payment-workers.service";
import { PaymentsController } from "./payments.controller";
import { PaymentsService } from "./payments.service";
import { ReconciliationService } from "./reconciliation.service";
import { WebhookController } from "./webhook.controller";
import { WebhookService } from "./webhook.service";

@Module({
  controllers: [PaymentsController, WebhookController],
  imports: [
    AuthModule,
    CashfreeModule,
    DatabaseModule,
    IdempotencyModule,
    InventoryModule,
    RateLimitModule,
    RbacModule,
    SecurityModule
  ],
  providers: [
    PaymentTransitionService,
    PaymentWorkersService,
    PaymentsService,
    ReconciliationService,
    WebhookService
  ],
  exports: [PaymentTransitionService, PaymentsService, ReconciliationService, WebhookService]
})
export class PaymentsModule {}
