import { ForbiddenException } from "@nestjs/common";
import { TenantResolver } from "../../modules/stores/tenant-resolver.service";

describe("TenantResolver", () => {
  it("attaches tenant context for an authorized store member", async () => {
    const stores = {
      findById: jest.fn(async () => ({ id: "store-1", slug: "fresh-mart", deletedAt: null }))
    };
    const rbac = {
      storeAuthorization: jest.fn(async () => ({
        storeId: "store-1",
        memberId: "member-1",
        roleCodes: ["STORE_MANAGER"],
        permissions: ["store:read"],
        isPlatformAdmin: false
      }))
    };
    const resolver = new TenantResolver(stores as never, rbac as never);
    const request = {
      params: { storeId: "store-1" },
      headers: {},
      auth: { userId: "user-1", authzVersion: 3 }
    } as never;

    const tenant = await resolver.resolve(request);

    expect(tenant).toEqual({
      storeId: "store-1",
      memberId: "member-1",
      roleCodes: ["STORE_MANAGER"],
      permissions: ["store:read"],
      isPlatformAdmin: false,
      slug: "fresh-mart"
    });
    expect((request as { tenant?: unknown }).tenant).toEqual(tenant);
  });

  it("denies access when the user has no active store membership", async () => {
    const resolver = new TenantResolver(
      {
        findById: jest.fn(async () => ({ id: "store-1", slug: "fresh-mart", deletedAt: null }))
      } as never,
      {
        storeAuthorization: jest.fn(async () => ({
          storeId: "store-1",
          roleCodes: [],
          permissions: [],
          isPlatformAdmin: false
        }))
      } as never
    );

    await expect(
      resolver.resolve({
        params: { storeId: "store-1" },
        headers: {},
        auth: { userId: "user-2", authzVersion: 1 }
      } as never)
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
