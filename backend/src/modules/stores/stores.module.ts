import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { RbacModule } from "../rbac/rbac.module";
import { StoreMemberRepository } from "./repositories/store-member.repository";
import { StoreRepository } from "./repositories/store.repository";
import { StoreCreationService } from "./store-creation.service";
import { TenantResolver } from "./tenant-resolver.service";

@Module({
  imports: [DatabaseModule, RbacModule],
  providers: [
    StoreRepository,
    StoreMemberRepository,
    StoreCreationService,
    TenantResolver
  ],
  exports: [
    StoreRepository,
    StoreMemberRepository,
    StoreCreationService,
    TenantResolver
  ]
})
export class StoresModule {}
