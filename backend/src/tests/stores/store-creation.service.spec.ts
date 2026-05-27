import { StoreMemberStatus } from "@prisma/client";
import { ROLE_CODES } from "../../modules/rbac/permissions";
import { StoreCreationService } from "../../modules/stores/store-creation.service";

describe("StoreCreationService", () => {
  it("creates a pending store and active merchant-owner membership", async () => {
    const stores = {
      findPendingByCreatorAndName: jest.fn(async () => null),
      findBySlug: jest.fn(async () => null),
      createPending: jest.fn(async () => ({ id: "store-1", slug: "fresh-mart" }))
    };
    const roles = {
      ensureStoreRole: jest.fn(async () => ({ id: "member-1" }))
    };
    const service = new StoreCreationService(stores as never, roles as never);

    await service.ensurePendingStoreForMerchant(
      {
        ownerUserId: "user-1",
        storeName: "Fresh Mart",
        email: "owner@example.com"
      },
      {} as never
    );

    expect(stores.createPending).toHaveBeenCalledWith(
      {
        createdByUserId: "user-1",
        name: "Fresh Mart",
        slug: "fresh-mart",
        email: "owner@example.com",
        phone: undefined
      },
      {}
    );
    expect(roles.ensureStoreRole).toHaveBeenCalledWith(
      {
        storeId: "store-1",
        userId: "user-1",
        roleCode: ROLE_CODES.MERCHANT_OWNER,
        status: StoreMemberStatus.ACTIVE,
        joinedAt: expect.any(Date)
      },
      {}
    );
  });
});
