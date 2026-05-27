import { ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { Request, Response } from "express";
import { AdminAuthService } from "../../modules/admin/admin-auth.service";
import { CryptoService } from "../../security/crypto.service";

function config(values: Record<string, unknown>) {
  return {
    get: jest.fn((key: string, fallback?: unknown) => values[key] ?? fallback)
  };
}

function response() {
  return {
    cookie: jest.fn(),
    clearCookie: jest.fn()
  } as unknown as Response & {
    cookie: jest.Mock;
    clearCookie: jest.Mock;
  };
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    ip: "127.0.0.1",
    method: "POST",
    cookies: {},
    header: jest.fn(),
    ...overrides
  } as unknown as Request;
}

describe("AdminAuthService", () => {
  it("sets a signed admin session and validates admin CSRF", async () => {
    const crypto = new CryptoService(config({}) as never);
    const service = new AdminAuthService(
      config({
        ADMIN_APPROVAL_PASSWORD: "correct-password",
        ADMIN_APPROVAL_SESSION_SECRET: "test-admin-secret-minimum-32-characters",
        ADMIN_APPROVAL_SESSION_TTL_SECONDS: 3600
      }) as never,
      crypto,
      { verify: jest.fn() } as never,
      { enforce: jest.fn(async () => undefined) } as never
    );
    const res = response();

    const login = await service.login("correct-password", request(), res);
    const sessionCookie = res.cookie.mock.calls.find(([name]) => name === "namastore_admin_session")?.[1];
    const csrfCookie = res.cookie.mock.calls.find(([name]) => name === "namastore_admin_csrf")?.[1];

    expect(login.authenticated).toBe(true);
    expect(sessionCookie).toBeTruthy();
    expect(csrfCookie).toBeTruthy();
    expect(res.cookie.mock.calls[0]?.[2]).toEqual(expect.objectContaining({ httpOnly: true }));
    expect(res.cookie.mock.calls[1]?.[2]).toEqual(expect.objectContaining({ httpOnly: false }));

    const guardedRequest = request({
      cookies: {
        namastore_admin_session: sessionCookie,
        namastore_admin_csrf: csrfCookie
      },
      header: jest.fn((name: string) => (name.toLowerCase() === "x-admin-csrf" ? csrfCookie : undefined))
    });

    expect(service.validateRequest(guardedRequest).sessionId).toBe(login.sessionId);
  });

  it("rejects admin CSRF mismatch", async () => {
    const crypto = new CryptoService(config({}) as never);
    const service = new AdminAuthService(
      config({
        ADMIN_APPROVAL_PASSWORD: "correct-password",
        ADMIN_APPROVAL_SESSION_SECRET: "test-admin-secret-minimum-32-characters",
        ADMIN_APPROVAL_SESSION_TTL_SECONDS: 3600
      }) as never,
      crypto,
      { verify: jest.fn() } as never,
      { enforce: jest.fn(async () => undefined) } as never
    );
    const res = response();

    await service.login("correct-password", request(), res);
    const sessionCookie = res.cookie.mock.calls.find(([name]) => name === "namastore_admin_session")?.[1];
    const csrfCookie = res.cookie.mock.calls.find(([name]) => name === "namastore_admin_csrf")?.[1];

    const guardedRequest = request({
      cookies: {
        namastore_admin_session: sessionCookie,
        namastore_admin_csrf: csrfCookie
      },
      header: jest.fn(() => "wrong-token")
    });

    expect(() => service.validateRequest(guardedRequest)).toThrow(UnauthorizedException);
  });

  it("does not unlock the admin console when password env is missing", async () => {
    const passwords = { verify: jest.fn(async () => false) };
    const service = new AdminAuthService(
      config({
        ADMIN_APPROVAL_SESSION_SECRET: "test-admin-secret-minimum-32-characters"
      }) as never,
      new CryptoService(config({}) as never),
      passwords as never,
      { enforce: jest.fn(async () => undefined) } as never
    );

    await expect(service.login("anything", request(), response())).rejects.toThrow(
      ServiceUnavailableException
    );
    expect(passwords.verify).toHaveBeenCalledWith("anything", null);
  });
});
