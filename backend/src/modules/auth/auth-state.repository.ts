import { Injectable } from "@nestjs/common";
import {
  OnboardingLifecycleState,
  StoreStatus,
  UserStatus
} from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { ROLE_CODES } from "../rbac/permissions";
import { RedisService } from "../redis/redis.service";
import { AuthRouteState } from "./auth.types";

const ROUTE_STATE_CACHE_TTL_SECONDS = 60;

interface AuthRouteStateRow {
  user_id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  status: UserStatus;
  email_verified: boolean;
  authz_version: number;
  role_codes: string[] | null;
  merchant_store_id: string | null;
  merchant_store_status: StoreStatus | null;
  onboarding_state: OnboardingLifecycleState | null;
  onboarding_complete: boolean | null;
}

@Injectable()
export class AuthStateRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService
  ) {}

  async getCachedOrLoadRouteState(userId: string, authzVersion?: number): Promise<AuthRouteState> {
    if (authzVersion !== undefined) {
      const cached = await this.getCachedRouteState(userId, authzVersion);
      if (cached) {
        return cached;
      }
    }

    const routeState = await this.getRouteState(userId);
    await this.cacheRouteState(routeState);
    return routeState;
  }

  async getRouteState(userId: string): Promise<AuthRouteState> {
    const rows = await this.prisma.$queryRaw<AuthRouteStateRow[]>`
      WITH platform_roles AS (
        SELECT
          ur.user_id,
          ARRAY_AGG(DISTINCT r.code) FILTER (WHERE r.code IS NOT NULL) AS role_codes
        FROM user_roles ur
        JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = ${userId}::uuid
          AND ur.revoked_at IS NULL
        GROUP BY ur.user_id
      ),
      current_store AS (
        SELECT
          s.id,
          s.status,
          s.created_at,
          sr.code AS store_role_code,
          os.state AS onboarding_state,
          CASE
            WHEN s.status = 'APPROVED' THEN true
            WHEN os.state IN ('APPROVAL_PENDING', 'ACTIVE', 'LAUNCHED') THEN true
            ELSE false
          END AS onboarding_complete
        FROM store_members sm
        JOIN roles sr ON sr.id = sm.role_id
        JOIN stores s ON s.id = sm.store_id
        LEFT JOIN store_onboarding_states os ON os.store_id = s.id
        WHERE sm.user_id = ${userId}::uuid
          AND sm.status = 'ACTIVE'
          AND s.deleted_at IS NULL
          AND s.status IN ('PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED')
        ORDER BY
          CASE
            WHEN s.status = 'APPROVED' THEN 0
            WHEN s.status = 'PENDING' THEN 1
            ELSE 2
          END,
          s.created_at DESC
        LIMIT 1
      )
      SELECT
        u.id AS user_id,
        u.email,
        u.full_name,
        u.avatar_url,
        u.status,
        u.email_verified,
        u.authz_version,
        COALESCE(platform_roles.role_codes, ARRAY[]::text[])
          || COALESCE(ARRAY_REMOVE(ARRAY[current_store.store_role_code], NULL), ARRAY[]::text[])
          AS role_codes,
        current_store.id AS merchant_store_id,
        current_store.status AS merchant_store_status,
        current_store.onboarding_state,
        COALESCE(current_store.onboarding_complete, false) AS onboarding_complete
      FROM users u
      LEFT JOIN platform_roles ON platform_roles.user_id = u.id
      LEFT JOIN current_store ON true
      WHERE u.id = ${userId}::uuid
      LIMIT 1
    `;

    const row = rows[0];
    if (!row) {
      throw new Error("Authenticated user was not found.");
    }
    return this.toRouteState(row);
  }

  async cacheRouteState(routeState: AuthRouteState): Promise<void> {
    await this.redis.setEx(
      this.routeStateKey(routeState.user.id, routeState.user.authzVersion),
      ROUTE_STATE_CACHE_TTL_SECONDS,
      JSON.stringify(routeState)
    );
  }

  async invalidateRouteState(userId: string, authzVersion: number): Promise<void> {
    await this.redis.del(this.routeStateKey(userId, authzVersion));
  }

  private async getCachedRouteState(
    userId: string,
    authzVersion: number
  ): Promise<AuthRouteState | null> {
    const cached = await this.redis.get(this.routeStateKey(userId, authzVersion));
    if (!cached) {
      return null;
    }
    try {
      const parsed = JSON.parse(cached) as Partial<AuthRouteState>;
      if (
        parsed.user?.id !== userId ||
        parsed.user.authzVersion !== authzVersion ||
        typeof parsed.redirectTo !== "string" ||
        !Array.isArray(parsed.roleCodes)
      ) {
        return null;
      }
      return parsed as AuthRouteState;
    } catch {
      return null;
    }
  }

  private toRouteState(row: AuthRouteStateRow): AuthRouteState {
    const roleCodes = Array.from(new Set((row.role_codes ?? []).filter(Boolean))).sort();
    return {
      user: {
        id: row.user_id,
        email: row.email,
        fullName: row.full_name,
        avatarUrl: row.avatar_url,
        status: row.status,
        emailVerified: row.email_verified,
        authzVersion: row.authz_version
      },
      roleCodes,
      merchantStoreId: row.merchant_store_id,
      merchantStoreStatus: row.merchant_store_status,
      onboardingState: row.onboarding_state,
      onboardingComplete: Boolean(row.onboarding_complete),
      redirectTo: this.redirectFor(row, roleCodes)
    };
  }

  private redirectFor(row: AuthRouteStateRow, roleCodes: string[]): string {
    if (!roleCodes.includes(ROLE_CODES.MERCHANT_OWNER)) {
      return "/";
    }

    if (
      row.merchant_store_status === StoreStatus.REJECTED ||
      row.merchant_store_status === StoreStatus.SUSPENDED
    ) {
      return "/";
    }

    if (row.merchant_store_status === StoreStatus.APPROVED || row.onboarding_complete) {
      return "/merchant/dashboard";
    }

    return "/merchant/onboarding";
  }

  private routeStateKey(userId: string, authzVersion: number) {
    return `route-state:${userId}:${authzVersion}`;
  }
}
