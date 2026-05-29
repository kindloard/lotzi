import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { UserStatus } from "@prisma/client";
import { Request } from "express";
import { requestTimer } from "../../../common/request-timing";
import { TokenService } from "../../../security/token.service";
import { ObservabilityService } from "../../observability/observability.service";
import {
  AUTH_ACCESS_INVALID,
  AUTH_ACCESS_MISSING,
  authUnauthorized
} from "../auth-errors";
import { AuthenticatedRequest } from "../auth.types";

@Injectable()
export class JwtHintGuard implements CanActivate {
  constructor(
    private readonly tokens: TokenService,
    private readonly observability: ObservabilityService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    return requestTimer(request).time("auth", async () => {
      const rawToken = this.extractToken(request);
      if (!rawToken) {
        this.observability.recordAuthAccessMissing();
        throw authUnauthorized(AUTH_ACCESS_MISSING, "Missing access token.");
      }

      const token = await this.tokens.verifyAccessToken(rawToken).catch(() => {
        this.observability.recordAuthAccessInvalid("jwt_invalid");
        throw authUnauthorized(AUTH_ACCESS_INVALID, "Invalid access token.");
      });

      request.auth = {
        userId: token.userId,
        sessionId: token.sessionId,
        tokenFamilyId: token.tokenFamilyId,
        roleCodes: [],
        permissions: [],
        isPlatformAdmin: false,
        authzVersion: token.authzVersion,
        user: {
          id: token.userId,
          email: "",
          fullName: null,
          avatarUrl: null,
          status: UserStatus.ACTIVE,
          emailVerified: false,
          authzVersion: token.authzVersion
        }
      };
      return true;
    });
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
