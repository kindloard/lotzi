import { ForbiddenException } from "@nestjs/common";
import { StoreStatus, UserStatus } from "@prisma/client";
import { AuthenticatedPrincipal } from "../../modules/auth/auth.types";
import { MerchantDashboardService } from "../../modules/merchant-dashboard/merchant-dashboard.service";

const auth = {
  userId: "user-1",
  sessionId: "session-1",
  tokenFamilyId: "family-1",
  roleCodes: ["MERCHANT_OWNER"],
  permissions: [],
  isPlatformAdmin: false,
  authzVersion: 1,
  user: {
    id: "user-1",
    email: "cached@example.com",
    fullName: "Cached User",
    avatarUrl: null,
    status: UserStatus.ACTIVE,
    emailVerified: true,
    authzVersion: 1
  }
} satisfies AuthenticatedPrincipal;

function serviceWithMembership(membership: unknown) {
  const prisma = {
    $queryRaw: jest.fn(async (..._args: unknown[]) => (membership ? [membership] : [])),
    store: {
      update: jest.fn()
    }
  };
  const redis = {
    del: jest.fn(async () => 1)
  };
  return {
    prisma,
    redis,
    service: new MerchantDashboardService(prisma as never, redis as never)
  };
}

describe("MerchantDashboardService", () => {
  it("returns DB-backed user, store name, and store logo for the active merchant membership", async () => {
    const { prisma, service } = serviceWithMembership({
      user_id: "user-1",
      user_email: "raja@example.com",
      full_name: "Raja Raman",
      avatar_url: "https://example.com/avatar.png",
      store_id: "store-1",
      store_name: "Fallback Store",
      store_slug: "fresh-mart",
      store_status: StoreStatus.APPROVED,
      store_image_url: null,
      business_name: "Fresh Mart",
      logo_url: "https://res.cloudinary.com/demo/image/upload/logo.png",
      role_code: "MERCHANT_OWNER",
      role_name: "Merchant owner"
    });

    await expect(service.bootstrap(auth)).resolves.toEqual({
      user: {
        id: "user-1",
        name: "Raja Raman",
        email: "raja@example.com",
        avatarUrl: "https://example.com/avatar.png"
      },
      store: {
        id: "store-1",
        name: "Fresh Mart",
        slug: "fresh-mart",
        status: StoreStatus.APPROVED,
        logoUrl: "https://res.cloudinary.com/demo/image/upload/logo.png"
      },
      membership: {
        roleCode: "MERCHANT_OWNER",
        roleName: "Merchant owner"
      }
    });

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it("allows a pending active merchant store so dashboard chrome can show real identity during onboarding", async () => {
    const { service } = serviceWithMembership({
      user_id: "user-1",
      user_email: "raja@example.com",
      full_name: null,
      avatar_url: null,
      store_id: "store-pending",
      store_name: "Raja Draft Store",
      store_slug: "raja-draft-store",
      store_status: StoreStatus.PENDING,
      store_image_url: "https://example.com/store.png",
      business_name: null,
      logo_url: null,
      role_code: "MERCHANT_OWNER",
      role_name: "Merchant owner"
    });

    await expect(service.bootstrap(auth)).resolves.toEqual({
      user: {
        id: "user-1",
        name: "raja",
        email: "raja@example.com",
        avatarUrl: null
      },
      store: {
        id: "store-pending",
        name: "Raja Draft Store",
        slug: "raja-draft-store",
        status: StoreStatus.PENDING,
        logoUrl: "https://example.com/store.png"
      },
      membership: {
        roleCode: "MERCHANT_OWNER",
        roleName: "Merchant owner"
      }
    });
  });

  it("keeps the dashboard selector aligned with auth route-state store eligibility", async () => {
    const { prisma, service } = serviceWithMembership({
      user_id: "user-1",
      user_email: "raja@example.com",
      full_name: "Raja Raman",
      avatar_url: null,
      store_id: "store-1",
      store_name: "Fresh Mart",
      store_slug: "fresh-mart",
      store_status: StoreStatus.APPROVED,
      store_image_url: null,
      business_name: null,
      logo_url: null,
      role_code: "MERCHANT_OWNER",
      role_name: "Merchant owner"
    });

    await service.bootstrap(auth);

    const query = (prisma.$queryRaw.mock.calls[0][0] as TemplateStringsArray).join(" ");
    expect(query).toContain("s.status IN ('PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED')");
    expect(query).not.toContain("os.state IN");
  });

  it("rejects dashboard identity when no active merchant membership exists", async () => {
    const { service } = serviceWithMembership(null);

    await expect(service.bootstrap(auth)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.bootstrap(auth)).rejects.toMatchObject({
      response: {
        code: "MERCHANT_STORE_REQUIRED",
        message: "No active merchant store is available for this account."
      }
    });
  });

  it("returns the active store's exact saved location for merchant settings", async () => {
    const { service } = serviceWithMembership({
      user_id: "user-1",
      user_email: "raja@example.com",
      full_name: "Raja Raman",
      avatar_url: null,
      store_id: "store-1",
      store_name: "Auxi store",
      store_slug: "mr-aj",
      store_status: StoreStatus.APPROVED,
      store_address_line: "Market road",
      store_city: "Tirunelveli",
      store_state: "Tamil Nadu",
      store_pincode: "627001",
      store_latitude: "8.7128180",
      store_longitude: "77.4215380",
      store_updated_at: new Date("2026-05-28T10:00:00.000Z"),
      store_image_url: null,
      business_name: null,
      logo_url: null,
      role_code: "MERCHANT_OWNER",
      role_name: "Merchant owner"
    });

    await expect(service.getStoreLocation(auth)).resolves.toEqual({
      id: "store-1",
      name: "Auxi store",
      slug: "mr-aj",
      status: StoreStatus.APPROVED,
      addressLine: "Market road",
      city: "Tirunelveli",
      state: "Tamil Nadu",
      pincode: "627001",
      latitude: 8.712818,
      longitude: 77.421538,
      googleMapsUrl: "https://www.google.com/maps/search/?api=1&query=8.712818,77.421538",
      updatedAt: "2026-05-28T10:00:00.000Z"
    });
  });

  it("saves rounded coordinates and invalidates public shop caches", async () => {
    const { prisma, redis, service } = serviceWithMembership({
      user_id: "user-1",
      user_email: "raja@example.com",
      full_name: null,
      avatar_url: null,
      store_id: "store-1",
      store_name: "Auxi store",
      store_slug: "mr-aj",
      store_status: StoreStatus.APPROVED,
      store_address_line: null,
      store_city: null,
      store_state: null,
      store_pincode: null,
      store_latitude: null,
      store_longitude: null,
      store_updated_at: new Date("2026-05-28T09:00:00.000Z"),
      store_image_url: null,
      business_name: null,
      logo_url: null,
      role_code: "MERCHANT_OWNER",
      role_name: "Merchant owner"
    });
    prisma.store.update.mockResolvedValue({
      id: "store-1",
      name: "Auxi store",
      slug: "mr-aj",
      status: StoreStatus.APPROVED,
      addressLine: "Market road",
      city: "Tirunelveli",
      state: "Tamil Nadu",
      pincode: "627001",
      latitude: "8.7128181",
      longitude: "77.4215382",
      updatedAt: new Date("2026-05-28T11:00:00.000Z")
    });

    await expect(service.updateStoreLocation(auth, {
      latitude: 8.712818123,
      longitude: 77.421538234,
      addressLine: " Market road ",
      city: " Tirunelveli ",
      state: " Tamil Nadu ",
      pincode: "627001"
    })).resolves.toMatchObject({
      latitude: 8.7128181,
      longitude: 77.4215382,
      googleMapsUrl: "https://www.google.com/maps/search/?api=1&query=8.7128181,77.4215382"
    });

    expect(prisma.store.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "store-1" },
      data: expect.objectContaining({
        latitude: 8.7128181,
        longitude: 77.4215382,
        addressLine: "Market road"
      })
    }));
    expect(redis.del).toHaveBeenCalledWith("shops:list:v1");
    expect(redis.del).toHaveBeenCalledWith("shops:products:v1");
  });
});
