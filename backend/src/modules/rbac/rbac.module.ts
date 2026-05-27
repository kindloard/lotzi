import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { RedisModule } from "../redis/redis.module";
import { RbacGuard } from "./rbac.guard";
import { AuthStateInvalidator } from "./auth-state-invalidator.service";
import { RbacEngine } from "./rbac.engine";
import { RoleSeedService } from "./role-seed.service";
import { RoleAssignmentService } from "./role-assignment.service";
import { RoleRepository } from "./repositories/role.repository";

@Module({
  imports: [DatabaseModule, RedisModule],
  providers: [
    AuthStateInvalidator,
    RoleRepository,
    RoleSeedService,
    RbacEngine,
    RoleAssignmentService,
    RbacGuard
  ],
  exports: [
    AuthStateInvalidator,
    RoleRepository,
    RoleSeedService,
    RbacEngine,
    RoleAssignmentService,
    RbacGuard
  ]
})
export class RbacModule {}
