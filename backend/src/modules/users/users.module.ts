import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { RbacModule } from "../rbac/rbac.module";
import { CustomerProfileRepository } from "./repositories/customer-profile.repository";
import { IdentityProviderRepository } from "./repositories/identity-provider.repository";
import { MerchantProfileRepository } from "./repositories/merchant-profile.repository";
import { UserRepository } from "./repositories/user.repository";
import { CustomerCreationService } from "./services/customer-creation.service";
import { MerchantCreationService } from "./services/merchant-creation.service";
import { UserCreationService } from "./services/user-creation.service";

@Module({
  imports: [DatabaseModule, RbacModule],
  providers: [
    UserRepository,
    IdentityProviderRepository,
    CustomerProfileRepository,
    MerchantProfileRepository,
    UserCreationService,
    CustomerCreationService,
    MerchantCreationService
  ],
  exports: [
    UserRepository,
    IdentityProviderRepository,
    CustomerProfileRepository,
    MerchantProfileRepository,
    UserCreationService,
    CustomerCreationService,
    MerchantCreationService
  ]
})
export class UsersModule {}
