import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { FirebaseModule } from "../../integrations/firebase/firebase.module";
import { SecurityModule } from "../../security/security.module";
import { AuditModule } from "../audit/audit.module";
import { MailModule } from "../mail/mail.module";
import { ObservabilityModule } from "../observability/observability.module";
import { RateLimitModule } from "../rate-limit/rate-limit.module";
import { RbacModule } from "../rbac/rbac.module";
import { RedisModule } from "../redis/redis.module";
import { StoresModule } from "../stores/stores.module";
import { UsersModule } from "../users/users.module";
import { AuthController } from "./auth.controller";
import { AuthPerformanceService } from "./auth-performance.service";
import { AuthStateRepository } from "./auth-state.repository";
import { AuthRepository } from "./auth.repository";
import { AuthService } from "./auth.service";
import { AccessTokenGuard } from "./guards/access-token.guard";
import { CsrfGuard } from "./guards/csrf.guard";
import { SessionRepository } from "./repositories/session.repository";
import { SessionCacheService } from "./session-cache.service";
import { SessionService } from "./session.service";

@Module({
  imports: [
    DatabaseModule,
    FirebaseModule,
    SecurityModule,
    RedisModule,
    RateLimitModule,
    MailModule,
    ObservabilityModule,
    AuditModule,
    RbacModule,
    UsersModule,
    StoresModule
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthPerformanceService,
    AuthStateRepository,
    AuthRepository,
    SessionRepository,
    SessionCacheService,
    SessionService,
    AccessTokenGuard,
    CsrfGuard
  ],
  exports: [AuthService, AuthStateRepository, AccessTokenGuard, CsrfGuard, SessionCacheService]
})
export class AuthModule {}
