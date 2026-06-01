import { Module } from "@nestjs/common";
import { PhonepeModule } from "../../integrations/phonepe/phonepe.module";
import { DatabaseModule } from "../../database/database.module";
import { SecurityModule } from "../../security/security.module";
import { AuthModule } from "../auth/auth.module";
import { ObservabilityModule } from "../observability/observability.module";
import { RbacModule } from "../rbac/rbac.module";
import { RedisModule } from "../redis/redis.module";
import { PaymentSettingsController } from "./payment-settings.controller";
import { PaymentSettingsEncryptionService } from "./encryption.service";
import { PaymentSettingsService } from "./payment-settings.service";

@Module({
  imports: [AuthModule, DatabaseModule, ObservabilityModule, PhonepeModule, RbacModule, RedisModule, SecurityModule],
  controllers: [PaymentSettingsController],
  providers: [PaymentSettingsEncryptionService, PaymentSettingsService],
  exports: [PaymentSettingsEncryptionService, PaymentSettingsService]
})
export class PaymentSettingsModule {}
