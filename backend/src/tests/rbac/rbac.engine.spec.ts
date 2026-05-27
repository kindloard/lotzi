import { RbacEngine } from "../../modules/rbac/rbac.engine";
import { PERMISSIONS } from "../../modules/rbac/permissions";

describe("RbacEngine", () => {
  it("caches store authorization by user, authz version, and store", async () => {
    const cache = new Map<string, string>();
    const roles = {
      findPlatformAuthorizationRows: jest.fn(async () => []),
      findActiveStoreMember: jest.fn(async () => ({
        id: "member-1",
        role: {
          code: "STORE_OWNER",
          permissions: [
            { permission: { code: PERMISSIONS.PRODUCT_MANAGE } }
          ]
        }
      })),
      listPermissions: jest.fn()
    };
    const redis = {
      get: jest.fn(async (key: string) => cache.get(key) ?? null),
      setEx: jest.fn(async (key: string, _seconds: number, value: string) => {
        cache.set(key, value);
      })
    };
    const engine = new RbacEngine(roles as never, redis as never);

    const first = await engine.storeAuthorization("user-1", "store-1", 7);
    const second = await engine.storeAuthorization("user-1", "store-1", 7);

    expect(first).toEqual(second);
    expect(first.permissions).toEqual([PERMISSIONS.PRODUCT_MANAGE]);
    expect(roles.findPlatformAuthorizationRows).toHaveBeenCalledTimes(1);
    expect(roles.findActiveStoreMember).toHaveBeenCalledTimes(1);
    expect(redis.setEx).toHaveBeenCalledWith(
      "authz:user-1:7:store:store-1",
      30,
      expect.any(String)
    );
  });

  it("does not reuse store authorization across authz versions", async () => {
    const cache = new Map<string, string>();
    const roles = {
      findPlatformAuthorizationRows: jest.fn(async () => []),
      findActiveStoreMember: jest.fn(async () => ({
        id: "member-1",
        role: {
          code: "STORE_OWNER",
          permissions: [{ permission: { code: PERMISSIONS.PRODUCT_MANAGE } }]
        }
      })),
      listPermissions: jest.fn()
    };
    const redis = {
      get: jest.fn(async (key: string) => cache.get(key) ?? null),
      setEx: jest.fn(async (key: string, _seconds: number, value: string) => {
        cache.set(key, value);
      })
    };
    const engine = new RbacEngine(roles as never, redis as never);

    await engine.storeAuthorization("user-1", "store-1", 7);
    await engine.storeAuthorization("user-1", "store-1", 8);

    expect(roles.findActiveStoreMember).toHaveBeenCalledTimes(2);
  });
});
