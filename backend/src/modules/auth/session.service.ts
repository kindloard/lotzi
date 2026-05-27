import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma, User } from "@prisma/client";
import { Response } from "express";
import { randomUUID } from "node:crypto";
import { TokenService } from "../../security/token.service";
import { AuthRequestTimer } from "./auth-performance.service";
import { RequestContext } from "./auth.types";
import { SessionRepository } from "./repositories/session.repository";

interface SessionCreateOptions {
  persistent?: boolean;
}

@Injectable()
export class SessionService {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly tokens: TokenService,
    private readonly config: ConfigService
  ) {}

  async create(
    user: User,
    context: RequestContext,
    response: Response,
    timer?: AuthRequestTimer,
    options: SessionCreateOptions = {}
  ) {
    const refresh = this.tokens.issueRefreshToken("root");
    const clientSecret = this.tokens.newClientSecret();
    const tokenFamilyId = randomUUID();
    const persistent = options.persistent ?? true;
    const expiresAt = this.daysFromNow(this.config.get<number>("REFRESH_TOKEN_TTL_DAYS", 30));
    const session = await this.time(timer, "session_insert", () =>
      this.sessions.create({
        userId: user.id,
        tokenFamilyId,
        refreshTokenHash: this.tokens.hashRefreshToken(refresh.token),
        refreshTokenJti: refresh.jti,
        refreshTokenParentJti: refresh.parentJti,
        refreshTokenIssuedAt: new Date(),
        clientSecretHash: this.tokens.hashClientSecret(clientSecret),
        deviceFingerprint: context.deviceFingerprint,
        deviceMetadata: context.deviceMetadata as Prisma.InputJsonValue,
        ipAddress: context.ip,
        userAgent: context.userAgent,
        expiresAt,
        persistent
      })
    );
    const access = await this.time(timer, "jwt_sign", () =>
      this.tokens.issueAccessToken({
        userId: user.id,
        sessionId: session.id,
        tokenFamilyId,
        authzVersion: user.authzVersion
      })
    );
    this.tokens.setAuthCookies(response, access.token, refresh.token, session.id, access.expiresAt, {
      persistent,
      clientSecret
    });
    return { session, access, refreshToken: refresh.token };
  }

  async refresh(user: User, sessionId: string, tokenFamilyId: string, response: Response) {
    const access = await this.tokens.issueAccessToken({
      userId: user.id,
      sessionId,
      tokenFamilyId,
      authzVersion: user.authzVersion
    });
    return access;
  }

  private daysFromNow(days: number): Date {
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  }

  private time<T>(
    timer: AuthRequestTimer | undefined,
    step: string,
    callback: () => Promise<T>
  ): Promise<T> {
    return timer ? timer.time(step, callback) : callback();
  }
}
