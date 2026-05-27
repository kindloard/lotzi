import { Request } from "express";
import { OnboardingLifecycleState, StoreStatus, UserStatus } from "@prisma/client";

export interface RequestContext {
  requestId?: string;
  ip?: string;
  userAgent?: string;
  deviceFingerprint: string;
  deviceMetadata: Record<string, string | undefined>;
}

export interface AuthenticatedPrincipal {
  userId: string;
  sessionId: string;
  tokenFamilyId: string;
  roleCodes: string[];
  permissions: string[];
  isPlatformAdmin: boolean;
  authzVersion: number;
  user: {
    id: string;
    email: string;
    fullName: string | null;
    avatarUrl: string | null;
    status: UserStatus;
    emailVerified: boolean;
    authzVersion: number;
  };
  routeState?: AuthRouteState;
}

export interface AuthRouteState {
  user: {
    id: string;
    email: string;
    fullName: string | null;
    avatarUrl: string | null;
    status: UserStatus;
    emailVerified: boolean;
    authzVersion: number;
  };
  roleCodes: string[];
  merchantStoreId: string | null;
  merchantStoreStatus: StoreStatus | null;
  onboardingState: OnboardingLifecycleState | null;
  onboardingComplete: boolean;
  redirectTo: string;
}

export interface TenantPrincipal {
  storeId: string;
  slug?: string;
  memberId?: string;
  roleCodes: string[];
  permissions: string[];
  isPlatformAdmin: boolean;
}

export interface AuthenticatedRequest extends Request {
  auth?: AuthenticatedPrincipal;
  tenant?: TenantPrincipal;
  requestId?: string;
}
