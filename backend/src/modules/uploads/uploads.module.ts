import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { CloudinaryModule } from "../../integrations/cloudinary/cloudinary.module";
import { SecurityModule } from "../../security/security.module";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { ObservabilityModule } from "../observability/observability.module";
import { RateLimitModule } from "../rate-limit/rate-limit.module";
import { RbacModule } from "../rbac/rbac.module";
import { RedisModule } from "../redis/redis.module";
import { IdempotencyService } from "./idempotency.service";
import { ProcessingSemaphore } from "./processing-semaphore.service";
import { UploadEngineService } from "./upload-engine.service";
import { UploadPolicyRegistry } from "./upload-policy.registry";
import { UploadsController } from "./uploads.controller";

@Module({
  controllers: [UploadsController],
  imports: [
    AuditModule,
    AuthModule,
    CloudinaryModule,
    DatabaseModule,
    ObservabilityModule,
    RateLimitModule,
    RbacModule,
    RedisModule,
    SecurityModule
  ],
  providers: [
    IdempotencyService,
    ProcessingSemaphore,
    UploadEngineService,
    UploadPolicyRegistry
  ],
  exports: [
    UploadEngineService,
    UploadPolicyRegistry
  ]
})
export class UploadsModule {}
