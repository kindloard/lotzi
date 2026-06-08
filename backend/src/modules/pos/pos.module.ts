import { Module } from '@nestjs/common';
import { PosRegisterController } from './pos-register/pos-register.controller';
import { PosRegisterService } from './pos-register/pos-register.service';
import { PosSessionController } from './pos-session/pos-session.controller';
import { PosSessionService } from './pos-session/pos-session.service';
import { PosCatalogController } from './pos-catalog/pos-catalog.controller';
import { PosCatalogService } from './pos-catalog/pos-catalog.service';
import { PosCheckoutController } from './pos-checkout/pos-checkout.controller';
import { PosCheckoutService } from './pos-checkout/pos-checkout.service';
import { AuthModule } from '../auth/auth.module';
import { SecurityModule } from '../../security/security.module';
import { RbacModule } from '../rbac/rbac.module';
import { DatabaseModule } from '../../database/database.module';
import { RedisModule } from '../redis/redis.module';
import { ObservabilityModule } from '../observability/observability.module';

@Module({
  imports: [AuthModule, SecurityModule, RbacModule, DatabaseModule, RedisModule, ObservabilityModule],
  controllers: [PosRegisterController, PosSessionController, PosCatalogController, PosCheckoutController],
  providers: [PosRegisterService, PosSessionService, PosCatalogService, PosCheckoutService]
})
export class PosModule {}
