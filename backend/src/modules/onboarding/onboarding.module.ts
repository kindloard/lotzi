import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { CloudinaryModule } from "../../integrations/cloudinary/cloudinary.module";
import { SecurityModule } from "../../security/security.module";
import { AuthModule } from "../auth/auth.module";
import { GeoDiscoveryModule } from "../geo-discovery/geo-discovery.module";
import { RbacModule } from "../rbac/rbac.module";
import { OnboardingController } from "./onboarding.controller";
import { ApprovalService } from "./services/approval.service";
import { BrandingService } from "./services/branding.service";
import { DomainEventService } from "./services/domain-event.service";
import { DraftService } from "./services/draft.service";
import { MerchantOnboardingStoreService } from "./services/merchant-onboarding-store.service";
import { OnboardingService } from "./services/onboarding.service";
import { OnboardingStateMachine } from "./services/onboarding-state-machine.service";
import { ValidationRuleEngine } from "./services/validation-rule-engine.service";

@Module({
  imports: [DatabaseModule, CloudinaryModule, GeoDiscoveryModule, RbacModule, SecurityModule, AuthModule],
  controllers: [OnboardingController],
  providers: [
    ApprovalService,
    BrandingService,
    DomainEventService,
    DraftService,
    MerchantOnboardingStoreService,
    OnboardingService,
    OnboardingStateMachine,
    ValidationRuleEngine
  ],
  exports: [OnboardingService]
})
export class OnboardingModule {}
