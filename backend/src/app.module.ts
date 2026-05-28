import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { validateEnv } from "./config/env";
import { DatabaseModule } from "./database/database.module";
import { AdminModule } from "./modules/admin/admin.module";
import { AuditModule } from "./modules/audit/audit.module";
import { AuthModule } from "./modules/auth/auth.module";
import { CartModule } from "./modules/cart/cart.module";
import { CategoriesModule } from "./modules/categories/categories.module";
import { CustomerAccountModule } from "./modules/customer-account/customer-account.module";
import { MailModule } from "./modules/mail/mail.module";
import { MerchantDashboardModule } from "./modules/merchant-dashboard/merchant-dashboard.module";
import { ObservabilityModule } from "./modules/observability/observability.module";
import { OnboardingModule } from "./modules/onboarding/onboarding.module";
import { OrdersModule } from "./modules/orders/orders.module";
import { PaymentsModule } from "./modules/payments/payments.module";
import { ProductsModule } from "./modules/products/products.module";
import { RateLimitModule } from "./modules/rate-limit/rate-limit.module";
import { RedisModule } from "./modules/redis/redis.module";
import { StoresModule } from "./modules/stores/stores.module";
import { ShopsModule } from "./modules/shops/shops.module";
import { UploadsModule } from "./modules/uploads/uploads.module";
import { UsersModule } from "./modules/users/users.module";
import { RbacModule } from "./modules/rbac/rbac.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    DatabaseModule,
    RedisModule,
    RateLimitModule,
    AuditModule,
    MailModule,
    MerchantDashboardModule,
    ObservabilityModule,
    OnboardingModule,
    RbacModule,
    AuthModule,
    UsersModule,
    CustomerAccountModule,
    StoresModule,
    ShopsModule,
    ProductsModule,
    CategoriesModule,
    CartModule,
    OrdersModule,
    PaymentsModule,
    UploadsModule,
    AdminModule
  ]
})
export class AppModule {}
