import { Injectable } from "@nestjs/common";
import { RoleScope, StoreStatus } from "@prisma/client";
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
  storeDeletedAt?: string | null;
  storeExists?: boolean;
  storeStatus?: StoreStatus;
}

const AUTHZ_CACHE_TTL_SECONDS = 30;
const AUTHZ_CACHE_TTL_MS = AUTHZ_CACHE_TTL_SECONDS * 1000;

interface LocalCacheEntry<T> {
  expiresAt: number;
  value: T;
}

@Injectable()
export class RbacEngine {
  private readonly localCache = new Map<string, LocalCacheEntry<AuthorizationContext | StoreAuthorizationContext>>();
  private readonly inflight = new Map<string, Promise<AuthorizationContext | StoreAuthorizationContext>>();

  constructor(
    private readonly roles: RoleRepository,
    private readonly redis: RedisService
  ) {}

  async platformAuthorization(userId: string, authzVersion: number): Promise<AuthorizationContext> {
    const cacheKey = `authz:${userId}:${authzVersion}:platform`;
    const local = this.getLocal<AuthorizationContext>(cacheKey);
    if (local) {
      return local;
    }
    const cached = await this.redis.get(cacheKey).catch(() => null);
    if (cached) {
      const parsed = JSON.parse(cached) as AuthorizationContext;
      this.setLocal(cacheKey, parsed);
      return parsed;
    }

    return this.singleflight<AuthorizationContext>(cacheKey, async () => {
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
      this.setLocal(cacheKey, authorization);
      await this.redis
        .setEx(cacheKey, AUTHZ_CACHE_TTL_SECONDS, JSON.stringify(authorization))
        .catch(() => undefined);
      return authorization;
    });
  }

  async storeAuthorization(
    userId: string,
    storeId: string,
    authzVersion: number
  ): Promise<StoreAuthorizationContext> {
    const cacheKey = `authz:${userId}:${authzVersion}:store:${storeId}`;
    const local = this.getLocal<StoreAuthorizationContext>(cacheKey);
    if (local) {
      return local;
    }
    const cached = await this.redis.get(cacheKey).catch(() => null);
    if (cached) {
      const parsed = JSON.parse(cached) as StoreAuthorizationContext;
      this.setLocal(cacheKey, parsed);
      return parsed;
    }

    return this.singleflight<StoreAuthorizationContext>(cacheKey, async () => {
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
        this.setLocal(cacheKey, authorization);
        await this.redis
          .setEx(cacheKey, AUTHZ_CACHE_TTL_SECONDS, JSON.stringify(authorization))
          .catch(() => undefined);
        return authorization;
      }

      const rows = await this.roles.findStoreAuthorizationRows(userId, storeId);
      const first = rows[0];
      if (!first) {
        authorization = {
          storeId,
          roleCodes: [],
          permissions: [],
          isPlatformAdmin: false,
          storeExists: false
        };
        this.setLocal(cacheKey, authorization);
        await this.redis
          .setEx(cacheKey, AUTHZ_CACHE_TTL_SECONDS, JSON.stringify(authorization))
          .catch(() => undefined);
        return authorization;
      }

      const roleCodes = Array.from(new Set(rows.map((row) => row.role_code).filter((code): code is string => Boolean(code)))).sort();
      const permissions = Array.from(new Set(rows.map((row) => row.permission_code).filter((code): code is string => Boolean(code)))).sort();
      authorization = {
        storeId,
        memberId: first.member_id ?? undefined,
        roleCodes,
        permissions,
        isPlatformAdmin: false,
        storeDeletedAt: first.store_deleted_at?.toISOString() ?? null,
        storeExists: true,
        storeStatus: first.store_status as StoreStatus
      };
      this.setLocal(cacheKey, authorization);
      await this.redis
        .setEx(cacheKey, AUTHZ_CACHE_TTL_SECONDS, JSON.stringify(authorization))
        .catch(() => undefined);
      return authorization;
    });
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

  private getLocal<T extends AuthorizationContext | StoreAuthorizationContext>(key: string): T | null {
    const entry = this.localCache.get(key);
    if (!entry) {
      return null;
    }
    if (entry.expiresAt <= Date.now()) {
      this.localCache.delete(key);
      return null;
    }
    return entry.value as T;
  }

  private setLocal(key: string, value: AuthorizationContext | StoreAuthorizationContext): void {
    this.localCache.set(key, { value, expiresAt: Date.now() + AUTHZ_CACHE_TTL_MS });
  }

  private async singleflight<T extends AuthorizationContext | StoreAuthorizationContext>(
    key: string,
    load: () => Promise<T>
  ): Promise<T> {
    const existing = this.inflight.get(key);
    if (existing) {
      return existing as Promise<T>;
    }
    const promise = load().finally(() => {
      this.inflight.delete(key);
    });
    this.inflight.set(key, promise);
    return promise;
  }
}
