import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { generateKeyPairSync } from "node:crypto";
import { dirname, resolve } from "node:path";
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import type { CookieOptions, Response } from "express";
import type { JWTPayload } from "jose";
import { CryptoService } from "./crypto.service";
import { CsrfService } from "./csrf.service";
import {
  ACCESS_COOKIE,
  ACCESS_TOKEN_TYPE,
  CLIENT_COOKIE,
  CSRF_COOKIE,
  REFRESH_COOKIE,
  REFRESH_TOKEN_BYTES
} from "./security.constants";

export interface AccessTokenSubject {
  userId: string;
  sessionId: string;
  tokenFamilyId: string;
  authzVersion: number;
}

export interface VerifiedAccessToken {
  userId: string;
  sessionId: string;
  tokenFamilyId: string;
  authzVersion: number;
  jti: string;
}

interface AuthCookieOptions {
  persistent?: boolean;
  clientSecret?: string;
}

interface DevJwtKeyPairFile {
  algorithm: "EdDSA";
  privateKeyPem: string;
  publicKeyPem: string;
  createdAt: string;
}

export interface IssuedRefreshToken {
  token: string;
  jti: string;
  parentJti: string;
  secret: string;
}

export type ParsedRefreshToken =
  | { version: "v2"; jti: string; parentJti: string }
  | { version: "legacy" };

@Injectable()
export class TokenService implements OnModuleInit {
  private readonly logger = new Logger(TokenService.name);
  private privateKey?: CryptoKey | Uint8Array;
  private publicKey?: CryptoKey | Uint8Array;
  private generatedPrivatePem?: string;
  private generatedPublicPem?: string;

  constructor(
    private readonly config: ConfigService,
    private readonly crypto: CryptoService,
    private readonly csrf: CsrfService
  ) {}

  async onModuleInit(): Promise<void> {
    await Promise.all([this.getPrivateKey(), this.getPublicKey()]);
  }

  accessCookieName(): string {
    return this.usesHostPrefix() ? ACCESS_COOKIE : "namastore_access";
  }

  refreshCookieName(): string {
    return this.usesHostPrefix() ? REFRESH_COOKIE : "namastore_refresh";
  }

  csrfCookieName(): string {
    return this.usesHostPrefix() ? CSRF_COOKIE : "namastore_csrf";
  }

  clientCookieName(): string {
    return this.usesHostPrefix() ? CLIENT_COOKIE : "namastore_client";
  }

  async issueAccessToken(subject: AccessTokenSubject): Promise<{
    token: string;
    expiresAt: Date;
    jti: string;
  }> {
    const { SignJWT } = await import("jose");
    const privateKey = await this.getPrivateKey();
    const ttlSeconds = this.config.get<number>("ACCESS_TOKEN_TTL_SECONDS", 900);
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    const jti = this.crypto.randomBase64Url(16);

    const token = await new SignJWT({
      sid: subject.sessionId,
      token_family_id: subject.tokenFamilyId,
      authz_version: subject.authzVersion,
      typ: ACCESS_TOKEN_TYPE
    })
      .setProtectedHeader({
        alg: "EdDSA",
        kid: this.config.get<string>("JWT_KEY_ID", "local-dev")
      })
      .setSubject(subject.userId)
      .setIssuedAt()
      .setJti(jti)
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(privateKey);

    return { token, expiresAt, jti };
  }

  async verifyAccessToken(token: string): Promise<VerifiedAccessToken> {
    const { jwtVerify } = await import("jose");
    const publicKey = await this.getPublicKey();
    const result = await jwtVerify(token, publicKey);
    const payload = result.payload as JWTPayload & {
      sid?: string;
      token_family_id?: string;
      authz_version?: number;
      typ?: string;
    };

    if (
      payload.typ !== ACCESS_TOKEN_TYPE ||
      !payload.sub ||
      !payload.sid ||
      !payload.token_family_id ||
      typeof payload.authz_version !== "number" ||
      !payload.jti
    ) {
      throw new Error("Invalid access token payload.");
    }

    return {
      userId: payload.sub,
      sessionId: payload.sid,
      tokenFamilyId: payload.token_family_id,
      authzVersion: payload.authz_version,
      jti: payload.jti
    };
  }

  newRefreshToken(): string {
    return this.issueRefreshToken("root").token;
  }

  issueRefreshToken(parentJti = "root"): IssuedRefreshToken {
    const jti = this.crypto.randomBase64Url(16);
    const secret = this.crypto.randomBase64Url(REFRESH_TOKEN_BYTES);
    return {
      token: `v2.${jti}.${parentJti}.${secret}`,
      jti,
      parentJti,
      secret
    };
  }

  parseRefreshToken(token: string): ParsedRefreshToken {
    const parts = token.split(".");
    if (
      parts.length === 4 &&
      parts[0] === "v2" &&
      parts[1] &&
      parts[2] &&
      parts[3]
    ) {
      return {
        version: "v2",
        jti: parts[1],
        parentJti: parts[2]
      };
    }
    return { version: "legacy" };
  }

  hashRefreshToken(token: string): string {
    return this.crypto.hmac(token, this.crypto.pepper("REFRESH_TOKEN_PEPPER"));
  }

  newClientSecret(): string {
    return this.crypto.randomBase64Url(32);
  }

  hashClientSecret(secret: string): string {
    return this.crypto.hmac(secret, this.crypto.pepper("CLIENT_BINDING_PEPPER"));
  }

  setAuthCookies(
    response: Response,
    accessToken: string,
    refreshToken: string,
    sessionId: string,
    accessExpiresAt: Date,
    options: AuthCookieOptions = {}
  ): string {
    const persistent = options.persistent ?? true;
    const csrfToken = this.csrf.createToken(sessionId);
    const refreshMaxAge = this.config.get<number>("REFRESH_TOKEN_TTL_DAYS", 30) *
      24 *
      60 *
      60 *
      1000;
    response.cookie(this.accessCookieName(), accessToken, {
      ...this.baseCookieOptions(),
      ...this.cookieMaxAge(
        persistent,
        this.config.get<number>("ACCESS_TOKEN_TTL_SECONDS", 900) * 1000
      )
    });
    response.cookie(this.refreshCookieName(), refreshToken, {
      ...this.baseCookieOptions(),
      ...this.cookieMaxAge(persistent, refreshMaxAge)
    });
    if (options.clientSecret) {
      response.cookie(this.clientCookieName(), options.clientSecret, {
        ...this.baseCookieOptions(),
        ...this.cookieMaxAge(persistent, refreshMaxAge)
      });
    }
    response.cookie(this.csrfCookieName(), csrfToken, {
      ...this.baseCookieOptions(),
      httpOnly: false,
      ...this.cookieMaxAge(persistent, refreshMaxAge)
    });
    response.setHeader("x-access-expires-at", accessExpiresAt.toISOString());
    return csrfToken;
  }

  clearAuthCookies(response: Response): void {
    const options = this.baseCookieOptions();
    response.clearCookie(this.accessCookieName(), options);
    response.clearCookie(this.refreshCookieName(), options);
    response.clearCookie(this.clientCookieName(), options);
    response.clearCookie(this.csrfCookieName(), { ...options, httpOnly: false });
  }

  private baseCookieOptions(): CookieOptions {
    const sameSite = this.config.get<"lax" | "strict" | "none">("COOKIE_SAME_SITE", "lax");
    const cookieDomain = this.config.get<string>("COOKIE_DOMAIN");
    return {
      httpOnly: true,
      secure: this.isProduction() || sameSite === "none",
      sameSite,
      domain: this.usesHostPrefix() ? undefined : cookieDomain,
      path: "/"
    };
  }

  private cookieMaxAge(persistent: boolean, maxAge: number): Pick<CookieOptions, "maxAge"> {
    return persistent ? { maxAge } : {};
  }

  private isProduction(): boolean {
    return this.config.get<string>("NODE_ENV") === "production";
  }

  private usesHostPrefix(): boolean {
    return this.isProduction() && !this.config.get<string>("COOKIE_DOMAIN");
  }

  private async getPrivateKey(): Promise<CryptoKey | Uint8Array> {
    if (this.privateKey) {
      return this.privateKey;
    }
    const { importPKCS8 } = await import("jose");
    this.privateKey = await importPKCS8(this.privatePem(), "EdDSA");
    return this.privateKey;
  }

  private async getPublicKey(): Promise<CryptoKey | Uint8Array> {
    if (this.publicKey) {
      return this.publicKey;
    }
    const { importSPKI } = await import("jose");
    this.publicKey = await importSPKI(this.publicPem(), "EdDSA");
    return this.publicKey;
  }

  private privatePem(): string {
    const configured = this.config.get<string>("JWT_PRIVATE_KEY")?.replace(/\\n/g, "\n");
    if (configured) {
      return configured;
    }
    this.ensureDevKeyPair();
    return this.generatedPrivatePem!;
  }

  private publicPem(): string {
    const configured = this.config.get<string>("JWT_PUBLIC_KEY")?.replace(/\\n/g, "\n");
    if (configured) {
      return configured;
    }
    this.ensureDevKeyPair();
    return this.generatedPublicPem!;
  }

  private ensureDevKeyPair(): void {
    if (this.generatedPrivatePem && this.generatedPublicPem) {
      return;
    }
    if (this.isProduction()) {
      throw new Error("JWT_PRIVATE_KEY and JWT_PUBLIC_KEY are required in production.");
    }
    const keyPairPath = this.devKeyPairPath();
    if (keyPairPath) {
      const cached = this.readDevKeyPair(keyPairPath);
      if (cached) {
        this.generatedPrivatePem = cached.privateKeyPem;
        this.generatedPublicPem = cached.publicKeyPem;
        return;
      }
    }
    const pair = generateKeyPairSync("ed25519");
    this.generatedPrivatePem = pair.privateKey.export({
      format: "pem",
      type: "pkcs8"
    }) as string;
    this.generatedPublicPem = pair.publicKey.export({
      format: "pem",
      type: "spki"
    }) as string;
    if (keyPairPath) {
      this.writeDevKeyPair(keyPairPath, {
        algorithm: "EdDSA",
        privateKeyPem: this.generatedPrivatePem,
        publicKeyPem: this.generatedPublicPem,
        createdAt: new Date().toISOString()
      });
    }
  }

  private devKeyPairPath(): string | undefined {
    const configured = this.config.get<string>("JWT_DEV_KEYPAIR_PATH")?.trim();
    if (configured) {
      return resolve(configured);
    }
    if (this.config.get<string>("NODE_ENV") === "test") {
      return undefined;
    }
    return resolve(process.cwd(), ".cache", "dev-jwt-keypair.json");
  }

  private readDevKeyPair(keyPairPath: string): DevJwtKeyPairFile | undefined {
    try {
      const parsed = JSON.parse(readFileSync(keyPairPath, "utf8")) as Partial<DevJwtKeyPairFile>;
      if (
        parsed.algorithm === "EdDSA" &&
        typeof parsed.privateKeyPem === "string" &&
        typeof parsed.publicKeyPem === "string" &&
        parsed.privateKeyPem.includes("PRIVATE KEY") &&
        parsed.publicKeyPem.includes("PUBLIC KEY")
      ) {
        return parsed as DevJwtKeyPairFile;
      }
      throw new Error("Invalid development JWT keypair file.");
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "ENOENT") {
        return undefined;
      }
      this.logger.warn(
        `DEV_SESSION_INVALIDATED malformed development JWT keypair at ${keyPairPath}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      try {
        unlinkSync(keyPairPath);
      } catch (unlinkError) {
        if (
          !unlinkError ||
          typeof unlinkError !== "object" ||
          !("code" in unlinkError) ||
          (unlinkError as { code?: string }).code !== "ENOENT"
        ) {
          this.logger.warn(
            `Unable to delete malformed development JWT keypair at ${keyPairPath}: ${
              unlinkError instanceof Error ? unlinkError.message : String(unlinkError)
            }`
          );
        }
      }
      return undefined;
    }
  }

  private writeDevKeyPair(keyPairPath: string, keyPair: DevJwtKeyPairFile): void {
    try {
      mkdirSync(dirname(keyPairPath), { recursive: true });
      writeFileSync(keyPairPath, `${JSON.stringify(keyPair, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600
      });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "EEXIST") {
        const cached = this.readDevKeyPair(keyPairPath);
        if (!cached) {
          throw new Error(`Development JWT keypair disappeared while reading ${keyPairPath}.`);
        }
        this.generatedPrivatePem = cached.privateKeyPem;
        this.generatedPublicPem = cached.publicKeyPem;
        return;
      }
      this.logger.warn(
        `Unable to persist development JWT keypair at ${keyPairPath}; using in-memory keys for this process: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
}
