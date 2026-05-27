import { Injectable } from "@nestjs/common";
import { RoleScope } from "@prisma/client";
import { RedisService } from "../redis/redis.service";
import { PLATFORM_ADMIN_ROLE_CODES } from "./permissions";
import { RoleRepository } from "./repositories/role.repository";

export interface AuthorizationContext {
  roleCodes: string[];
  permissions: string[];
  isPlatformAdmin: boolean;
}

export interface StoreAuthorizationContext extends AuthorizationContext {
  storeId: string;
  memberId?: string;
}

@Injectable()
export class RbacEngine {
  constructor(
    private readonly roles: RoleRepository,
    private readonly redis: RedisService
  ) {}

  async platformAuthorization(userId: string, authzVersion: number): Promise<AuthorizationContext> {
    const cacheKey = `authz:${userId}:${authzVersion}:platform`;
    const cached = await this.redis.get(cacheKey).catch(() => null);
    if (cached) {
      return JSON.parse(cached) as AuthorizationContext;
    }

    const rows = await this.roles.findPlatformAuthorizationRows(userId);
    const roleCodes = Array.from(new Set(rows.map((row) => row.role_code))).sort();
    const permissions = new Set<string>(
      rows
        .map((row) => row.permission_code)
        .filter((permissionCode): permissionCode is string => Boolean(permissionCode))
    );

    const authorization = {
      roleCodes,
      permissions: Array.from(permissions).sort(),
      isPlatformAdmin: roleCodes.some((code) => PLATFORM_ADMIN_ROLE_CODES.has(code))
    };
    await this.redis
      .setEx(cacheKey, 30, JSON.stringify(authorization))
      .catch(() => undefined);
    return authorization;
  }

  async storeAuthorization(
    userId: string,
    storeId: string,
    authzVersion: number
  ): Promise<StoreAuthorizationContext> {
    const cacheKey = `authz:${userId}:${authzVersion}:store:${storeId}`;
    const cached = await this.redis.get(cacheKey).catch(() => null);
    if (cached) {
      return JSON.parse(cached) as StoreAuthorizationContext;
    }

    const platform = await this.platformAuthorization(userId, authzVersion);
    let authorization: StoreAuthorizationContext;
    if (platform.isPlatformAdmin) {
      const permissions = await this.roles.listPermissions(RoleScope.STORE);
      authorization = {
        storeId,
        roleCodes: platform.roleCodes,
        permissions: permissions.map((permission) => permission.code).sort(),
        isPlatformAdmin: true
      };
      await this.redis
        .setEx(cacheKey, 30, JSON.stringify(authorization))
        .catch(() => undefined);
      return authorization;
    }

    const member = await this.roles.findActiveStoreMember(userId, storeId);
    if (!member) {
      authorization = {
        storeId,
        roleCodes: [],
        permissions: [],
        isPlatformAdmin: false
      };
      await this.redis
        .setEx(cacheKey, 30, JSON.stringify(authorization))
        .catch(() => undefined);
      return authorization;
    }

    authorization = {
      storeId,
      memberId: member.id,
      roleCodes: [member.role.code],
      permissions: member.role.permissions
        .map((rolePermission) => rolePermission.permission.code)
        .sort(),
      isPlatformAdmin: false
    };
    await this.redis
      .setEx(cacheKey, 30, JSON.stringify(authorization))
      .catch(() => undefined);
    return authorization;
  }

  hasPermissions(actual: Iterable<string>, required: Iterable<string>): boolean {
    const available = new Set(actual);
    for (const permission of required) {
      if (!available.has(permission)) {
        return false;
      }
    }
    return true;
  }
}
