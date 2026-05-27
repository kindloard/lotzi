import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { UserStatus } from "@prisma/client";
import { Request } from "express";
import { requestTimer } from "../../../common/request-timing";
import { PrismaService } from "../../../database/prisma.service";
import { RbacEngine } from "../../rbac/rbac.engine";
import { TokenService, VerifiedAccessToken } from "../../../security/token.service";
import { ObservabilityService } from "../../observability/observability.service";
import {
  AUTH_ACCESS_INVALID,
  AUTH_ACCESS_MISSING,
  authUnauthorized
} from "../auth-errors";
import { AuthenticatedRequest } from "../auth.types";
import { CachedSessionPrincipal, SessionCacheService } from "../session-cache.service";

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
    private readonly rbac: RbacEngine,
    private readonly sessionCache: SessionCacheService,
    private readonly observability: ObservabilityService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    return requestTimer(request).time("auth", () => this.validateRequest(request));
  }

  private async validateRequest(request: AuthenticatedRequest): Promise<boolean> {
    const rawToken = this.extractToken(request);
    if (!rawToken) {
      this.observability.recordAuthAccessMissing();
      throw authUnauthorized(AUTH_ACCESS_MISSING, "Missing access token.");
    }

    const token = await this.tokens.verifyAccessToken(rawToken).catch(() => {
      this.observability.recordAuthAccessInvalid("jwt_invalid");
      throw authUnauthorized(AUTH_ACCESS_INVALID, "Invalid access token.");
    });

    const cached = await this.sessionCache.get(token.sessionId);
    if (cached) {
      this.assertCachedSession(cached, token);
      await this.attachPrincipal(request, token, cached);
      this.observability.recordAuthSessionValidated();
      return true;
    }

    const session = await this.prisma.session.findUnique({
      where: { id: token.sessionId },
      select: {
        id: true,
        userId: true,
        tokenFamilyId: true,
        revoked: true,
        expiresAt: true,
        user: {
          select: {
            id: true,
            email: true,
            fullName: true,
            avatarUrl: true,
            status: true,
            emailVerified: true,
            authzVersion: true
          }
        }
      }
    });
    if (
      !session ||
      session.revoked ||
      session.expiresAt <= new Date() ||
      session.user.status !== "ACTIVE" ||
      session.userId !== token.userId ||
      session.tokenFamilyId !== token.tokenFamilyId
    ) {
      this.observability.recordAuthAccessInvalid("session_invalid");
      throw authUnauthorized(AUTH_ACCESS_INVALID, "Invalid access token.");
    }

    const principal: CachedSessionPrincipal = {
      id: session.id,
      userId: session.userId,
      tokenFamilyId: session.tokenFamilyId,
      expiresAt: session.expiresAt.toISOString(),
      user: session.user
    };
    await this.sessionCache.set(principal);
    await this.attachPrincipal(request, token, principal);
    this.observability.recordAuthSessionValidated();
    return true;
  }

  private assertCachedSession(session: CachedSessionPrincipal, token: VerifiedAccessToken) {
    if (
      session.expiresAt &&
      new Date(session.expiresAt) <= new Date()
    ) {
      this.observability.recordAuthAccessInvalid("session_expired");
      throw authUnauthorized(AUTH_ACCESS_INVALID, "Invalid access token.");
    }
    if (
      session.user.status !== UserStatus.ACTIVE ||
      session.userId !== token.userId ||
      session.tokenFamilyId !== token.tokenFamilyId
    ) {
      this.observability.recordAuthAccessInvalid("session_mismatch");
      throw authUnauthorized(AUTH_ACCESS_INVALID, "Invalid access token.");
    }
    if (session.user.authzVersion !== token.authzVersion) {
      this.observability.recordAuthAccessInvalid("authz_stale");
      throw authUnauthorized(AUTH_ACCESS_INVALID, "Invalid access token.");
    }
  }

  private async attachPrincipal(
    request: AuthenticatedRequest,
    token: VerifiedAccessToken,
    session: CachedSessionPrincipal
  ) {
    const authzVersion = session.user.authzVersion;
    const authorization = await this.rbac.platformAuthorization(session.userId, authzVersion);

    request.auth = {
      userId: token.userId,
      sessionId: token.sessionId,
      tokenFamilyId: token.tokenFamilyId,
      roleCodes: authorization.roleCodes,
      permissions: authorization.permissions,
      isPlatformAdmin: authorization.isPlatformAdmin,
      authzVersion,
      user: session.user
    };
  }

  private extractToken(request: Request): string | undefined {
    const authorization = request.header("authorization");
    if (authorization?.startsWith("Bearer ")) {
      return authorization.slice("Bearer ".length);
    }
    const cookies = request.cookies as Record<string, string | undefined> | undefined;
    return cookies?.[this.tokens.accessCookieName()];
  }

}
