import { ConfigService } from "@nestjs/config";
import { Response } from "express";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CryptoService } from "../../security/crypto.service";
import { CsrfService } from "../../security/csrf.service";
import { TokenService } from "../../security/token.service";

function tokenService() {
  const config = new ConfigService({
    NODE_ENV: "test",
    ACCESS_TOKEN_TTL_SECONDS: 900,
    REFRESH_TOKEN_TTL_DAYS: 30,
    CSRF_PEPPER: "test-csrf-pepper-minimum-32-characters",
    REFRESH_TOKEN_PEPPER: "test-refresh-pepper-minimum-32-characters",
    CLIENT_BINDING_PEPPER: "test-client-binding-pepper-minimum-32-characters"
  });
  const crypto = new CryptoService(config);
  return new TokenService(config, crypto, new CsrfService(crypto));
}

function responseMock() {
  return {
    cookie: jest.fn(),
    setHeader: jest.fn()
  } as unknown as Response & {
    cookie: jest.Mock;
    setHeader: jest.Mock;
  };
}

describe("TokenService cookie persistence", () => {
  it("sets maxAge for persistent auth cookies", () => {
    const service = tokenService();
    const response = responseMock();

    service.setAuthCookies(
      response,
      "access",
      "refresh",
      "session-1",
      new Date("2026-05-22T00:00:00.000Z"),
      { persistent: true }
    );

    expect(response.cookie).toHaveBeenCalledWith(
      "lotzi_refresh",
      "refresh",
      expect.objectContaining({ maxAge: 30 * 24 * 60 * 60 * 1000 })
    );
    expect(response.cookie).toHaveBeenCalledWith(
      "lotzi_csrf",
      expect.any(String),
      expect.objectContaining({ httpOnly: false, maxAge: 30 * 24 * 60 * 60 * 1000 })
    );
  });

  it("sets the sender-constraint client cookie when a client secret is supplied", () => {
    const service = tokenService();
    const response = responseMock();

    service.setAuthCookies(
      response,
      "access",
      "refresh",
      "session-1",
      new Date("2026-05-22T00:00:00.000Z"),
      { persistent: true, clientSecret: "client-secret" }
    );

    expect(response.cookie).toHaveBeenCalledWith(
      "lotzi_client",
      "client-secret",
      expect.objectContaining({ httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000 })
    );
  });

  it("omits maxAge for browser-session auth cookies", () => {
    const service = tokenService();
    const response = responseMock();

    service.setAuthCookies(
      response,
      "access",
      "refresh",
      "session-1",
      new Date("2026-05-22T00:00:00.000Z"),
      { persistent: false }
    );

    for (const call of response.cookie.mock.calls) {
      expect(call[2]).not.toHaveProperty("maxAge");
    }
  });
});

describe("TokenService development signing keys", () => {
  it("reuses the persisted development keypair across service instances", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lotzi-jwt-"));
    const keyPairPath = join(dir, "jwt-dev-keypair.json");
    const config = new ConfigService({
      NODE_ENV: "development",
      JWT_DEV_KEYPAIR_PATH: keyPairPath,
      ACCESS_TOKEN_TTL_SECONDS: 900,
      REFRESH_TOKEN_TTL_DAYS: 30,
      CSRF_PEPPER: "test-csrf-pepper-minimum-32-characters",
      REFRESH_TOKEN_PEPPER: "test-refresh-pepper-minimum-32-characters",
      CLIENT_BINDING_PEPPER: "test-client-binding-pepper-minimum-32-characters"
    });
    const crypto = new CryptoService(config);

    try {
      const first = new TokenService(config, crypto, new CsrfService(crypto)) as unknown as {
        privatePem(): string;
        publicPem(): string;
      };
      const second = new TokenService(config, crypto, new CsrfService(crypto)) as unknown as {
        privatePem(): string;
        publicPem(): string;
      };

      expect(second.privatePem()).toBe(first.privatePem());
      expect(second.publicPem()).toBe(first.publicPem());
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("regenerates a malformed persisted development keypair without crashing dev startup", () => {
    const dir = mkdtempSync(join(tmpdir(), "lotzi-jwt-"));
    const keyPairPath = join(dir, "dev-jwt-keypair.json");
    writeFileSync(keyPairPath, "{bad-json", "utf8");
    const config = new ConfigService({
      NODE_ENV: "development",
      JWT_DEV_KEYPAIR_PATH: keyPairPath,
      ACCESS_TOKEN_TTL_SECONDS: 900,
      REFRESH_TOKEN_TTL_DAYS: 30,
      CSRF_PEPPER: "test-csrf-pepper-minimum-32-characters",
      REFRESH_TOKEN_PEPPER: "test-refresh-pepper-minimum-32-characters",
      CLIENT_BINDING_PEPPER: "test-client-binding-pepper-minimum-32-characters"
    });
    const crypto = new CryptoService(config);

    try {
      const service = new TokenService(config, crypto, new CsrfService(crypto)) as unknown as {
        privatePem(): string;
      };

      expect(service.privatePem()).toContain("PRIVATE KEY");
      expect(existsSync(keyPairPath)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
