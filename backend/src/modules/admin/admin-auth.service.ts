import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { CookieOptions, Request, Response } from "express";
import { CryptoService } from "../../security/crypto.service";
import { PasswordService } from "../../security/password.service";
import { RateLimitService } from "../rate-limit/rate-limit.service";

const ADMIN_SESSION_COOKIE = "namastore_admin_session";
const ADMIN_CSRF_COOKIE = "namastore_admin_csrf";
const SESSION_VERSION = "v1";

export interface AdminSession {
  sessionId: string;
  issuedAt: Date;
  expiresAt: Date;
}

interface SignedAdminSessionPayload {
  sid: string;
  iat: number;
  exp: number;
  csrfHash: string;
}

@Injectable()
export class AdminAuthService {
  constructor(
    private readonly config: ConfigService,
    private readonly crypto: CryptoService,
    private readonly passwords: PasswordService,
    private readonly rateLimit: RateLimitService
  ) {}

  async login(password: string, request: Request, response: Response) {
    await this.rateLimit.enforce(`admin-login:ip:${request.ip ?? "unknown"}`, 8, 15 * 60);

    if (!this.isConfigured()) {
      await this.passwords.verify(password, null);
      throw new ServiceUnavailableException("Admin approvals are not configured.");
    }

    const verified = await this.verifyPassword(password);
    if (!verified) {
      throw new UnauthorizedException("Invalid admin password.");
    }

    return this.createSession(response);
  }

  logout(response: Response) {
    response.clearCookie(ADMIN_SESSION_COOKIE, this.baseCookieOptions());
    response.clearCookie(ADMIN_CSRF_COOKIE, {
      ...this.baseCookieOptions(),
      httpOnly: false
    });
    return { authenticated: false };
  }

  validateRequest(request: Request): AdminSession {
    const cookies = request.cookies as Record<string, string | undefined> | undefined;
    const rawSession = cookies?.[ADMIN_SESSION_COOKIE];
    const session = this.verifySessionCookie(rawSession);
    const mutating = !["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase());

    if (mutating) {
      const csrfHeader = request.header("x-admin-csrf");
      const csrfCookie = cookies?.[ADMIN_CSRF_COOKIE];
      if (
        !csrfHeader ||
        !csrfCookie ||
        csrfHeader !== csrfCookie ||
        !this.crypto.timingSafeEqual(
          this.crypto.hmac(csrfHeader, this.secret()),
          session.csrfHash
        )
      ) {
        throw new UnauthorizedException("Admin CSRF validation failed.");
      }
    }

    return {
      sessionId: session.sid,
      issuedAt: new Date(session.iat * 1000),
      expiresAt: new Date(session.exp * 1000)
    };
  }

  session(request: Request) {
    const session = this.validateRequest(request);
    return {
      authenticated: true,
      sessionId: session.sessionId,
      expiresAt: session.expiresAt.toISOString()
    };
  }

  private async verifyPassword(password: string) {
    const hash = this.config.get<string>("ADMIN_APPROVAL_PASSWORD_HASH");
    if (hash) {
      return this.passwords.verify(password, hash);
    }

    const plaintext = this.config.get<string>("ADMIN_APPROVAL_PASSWORD");
    if (!plaintext) {
      return false;
    }

    return this.crypto.timingSafeEqual(
      this.crypto.hmac(password, this.secret()),
      this.crypto.hmac(plaintext, this.secret())
    );
  }

  private createSession(response: Response) {
    const now = Math.floor(Date.now() / 1000);
    const ttlSeconds = this.config.get<number>("ADMIN_APPROVAL_SESSION_TTL_SECONDS", 3600);
    const csrfToken = this.crypto.randomBase64Url(32);
    const payload: SignedAdminSessionPayload = {
      sid: this.crypto.randomBase64Url(24),
      iat: now,
      exp: now + ttlSeconds,
      csrfHash: this.crypto.hmac(csrfToken, this.secret())
    };
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const signature = this.crypto.hmac(`${SESSION_VERSION}.${body}`, this.secret());
    const cookieValue = `${SESSION_VERSION}.${body}.${signature}`;
    const maxAge = ttlSeconds * 1000;

    response.cookie(ADMIN_SESSION_COOKIE, cookieValue, {
      ...this.baseCookieOptions(),
      maxAge
    });
    response.cookie(ADMIN_CSRF_COOKIE, csrfToken, {
      ...this.baseCookieOptions(),
      httpOnly: false,
      maxAge
    });

    return {
      authenticated: true,
      sessionId: payload.sid,
      expiresAt: new Date(payload.exp * 1000).toISOString()
    };
  }

  private verifySessionCookie(rawSession?: string): SignedAdminSessionPayload {
    if (!rawSession) {
      throw new UnauthorizedException("Admin session is required.");
    }

    const [version, body, signature] = rawSession.split(".");
    if (version !== SESSION_VERSION || !body || !signature) {
      throw new UnauthorizedException("Admin session is invalid.");
    }

    const expectedSignature = this.crypto.hmac(`${version}.${body}`, this.secret());
    if (!this.crypto.timingSafeEqual(signature, expectedSignature)) {
      throw new UnauthorizedException("Admin session is invalid.");
    }

    let payload: SignedAdminSessionPayload;
    try {
      payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SignedAdminSessionPayload;
    } catch {
      throw new UnauthorizedException("Admin session is invalid.");
    }

    if (
      !payload.sid ||
      !Number.isInteger(payload.iat) ||
      !Number.isInteger(payload.exp) ||
      !payload.csrfHash ||
      payload.exp <= Math.floor(Date.now() / 1000)
    ) {
      throw new UnauthorizedException("Admin session has expired.");
    }

    return payload;
  }

  private isConfigured() {
    return Boolean(
      this.config.get<string>("ADMIN_APPROVAL_PASSWORD_HASH") ||
        this.config.get<string>("ADMIN_APPROVAL_PASSWORD")
    );
  }

  private baseCookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.isProduction() || this.config.get<"lax" | "strict" | "none">("COOKIE_SAME_SITE") === "none",
      sameSite: "strict",
      domain: this.config.get<string>("COOKIE_DOMAIN"),
      path: "/"
    };
  }

  private secret() {
    return this.config.get<string>(
      "ADMIN_APPROVAL_SESSION_SECRET",
      "local-dev-admin-approval-session-secret-change-before-prod"
    );
  }

  private isProduction() {
    return this.config.get<string>("NODE_ENV") === "production";
  }
}
