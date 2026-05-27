import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { CloudinaryModule } from "../../integrations/cloudinary/cloudinary.module";
import { SecurityModule } from "../../security/security.module";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { MailModule } from "../mail/mail.module";
import { RateLimitModule } from "../rate-limit/rate-limit.module";
import { RbacModule } from "../rbac/rbac.module";
import { CustomerAccountController } from "./customer-account.controller";
import { CustomerAccountService } from "./customer-account.service";

@Module({
  imports: [
    AuditModule,
    AuthModule,
    CloudinaryModule,
    DatabaseModule,
    MailModule,
    RateLimitModule,
    RbacModule,
    SecurityModule
  ],
  controllers: [CustomerAccountController],
  providers: [CustomerAccountService],
  exports: [CustomerAccountService]
})
export class CustomerAccountModule {}
