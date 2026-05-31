import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { OrderStatus, PaymentStatus, StoreStatus, UserStatus } from "@prisma/client";
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
    },
    order: {
      findMany: jest.fn(),
      findFirst: jest.fn()
    }
  };
  const transitions = {
    transitionOrder: jest.fn()
  };
  const shops = {
    invalidateShopCaches: jest.fn(async () => undefined)
  };
  return {
    prisma,
    transitions,
    shops,
    service: new MerchantDashboardService(prisma as never, transitions as never, shops as never)
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
    const { prisma, shops, service } = serviceWithMembership({
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
    expect(shops.invalidateShopCaches).toHaveBeenCalledWith({
      keyFamily: "all",
      operation: "merchant.location.update",
      storeId: "store-1"
    });
  });

  it("returns live store-scoped orders for the merchant dashboard", async () => {
    const { prisma, service } = serviceWithMembership({
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
    prisma.order.findMany.mockResolvedValue([{
      id: "8a516745-963d-4d54-9925-921f4f4ef041",
      status: OrderStatus.FULFILLMENT_READY,
      paymentStatus: PaymentStatus.PAID,
      total: "123.45",
      grandTotalPaise: 12345n,
      addressRecipientName: "Kavi",
      addressCity: "Tirunelveli",
      createdAt: new Date("2026-05-31T08:00:00.000Z"),
      updatedAt: new Date("2026-05-31T08:01:00.000Z"),
      user: { email: "kavi@example.com", fullName: null },
      payment: {
        id: "a9f73442-5c5d-451b-b74e-f1cef8c261e8",
        status: PaymentStatus.PAID,
        verifiedAt: new Date("2026-05-31T08:02:00.000Z"),
        createdAt: new Date("2026-05-31T08:00:00.000Z")
      },
      items: [
        {
          id: "f4f5c74b-f0bc-41a5-b477-585c618b5598",
          name: "Heritage Filter Coffee",
          variantName: "250 g",
          unitDisplay: "250 g",
          quantity: 2,
          unitPrice: "40",
          unitPricePaise: 4000n,
          total: "80",
          totalPaise: 8000n,
          product: { imageUrl: "https://cdn.example.com/coffee.jpg", sku: "COF-250" },
          variant: { sku: "COF-250-A" }
        },
        {
          id: "ad26e4c9-c7f2-4f34-a80f-f13f82c93c5c",
          name: "Premium Cashew Pack",
          variantName: null,
          unitDisplay: null,
          quantity: 1,
          unitPrice: "43.45",
          unitPricePaise: 4345n,
          total: "43.45",
          totalPaise: 4345n,
          product: { imageUrl: null, sku: "CSH-250" },
          variant: null
        }
      ],
      stateTransitions: [{
        toStatus: OrderStatus.PAYMENT_CONFIRMED,
        reason: "payment_paid",
        createdAt: new Date("2026-05-31T08:02:30.000Z")
      }, {
        toStatus: OrderStatus.FULFILLMENT_READY,
        reason: "inventory_finalized",
        createdAt: new Date("2026-05-31T08:03:00.000Z")
      }, {
        toStatus: OrderStatus.ACCEPTED,
        reason: "merchant_acceptance_ready",
        createdAt: new Date("2026-05-31T08:04:00.000Z")
      }, {
        toStatus: OrderStatus.PAYMENT_CONFIRMED,
        reason: "payment_webhook_retry",
        createdAt: new Date("2026-05-31T08:05:00.000Z")
      }]
    }]);

    await expect(service.orders(auth)).resolves.toMatchObject({
      apiVersion: "v1",
      orders: [{
        id: "8a516745-963d-4d54-9925-921f4f4ef041",
        customer: "Kavi",
        email: "kavi@example.com",
        total: 123.45,
        items: 3,
        lineItems: [
          expect.objectContaining({
            name: "Heritage Filter Coffee",
            quantity: 2,
            unitPrice: 40,
            total: 80,
            imageUrl: "https://cdn.example.com/coffee.jpg",
            sku: "COF-250-A"
          }),
          expect.objectContaining({
            name: "Premium Cashew Pack",
            quantity: 1,
            unitPrice: 43.45,
            total: 43.45
          })
        ],
        status: "Processing",
        payment: "Paid",
        channel: "Storefront",
        city: "Tirunelveli",
        placedAt: "2026-05-31T08:00:00.000Z",
        timeline: [
          { label: "Order created", at: "2026-05-31T08:00:00.000Z" },
          { label: "Payment confirmed", at: "2026-05-31T08:02:00.000Z" }
        ]
      }]
    });
    expect(prisma.order.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { storeId: "store-1" },
      take: 250
    }));
  });

  it("returns one live store-scoped order for deep-linked merchant order details", async () => {
    const { prisma, service } = serviceWithMembership({
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
    prisma.order.findFirst.mockResolvedValue({
      id: "8a516745-963d-4d54-9925-921f4f4ef041",
      status: OrderStatus.FULFILLMENT_READY,
      paymentStatus: PaymentStatus.PAID,
      total: "123.45",
      grandTotalPaise: 12345n,
      addressRecipientName: "Kavi",
      addressCity: "Tirunelveli",
      createdAt: new Date("2026-05-31T08:00:00.000Z"),
      updatedAt: new Date("2026-05-31T08:01:00.000Z"),
      user: { email: "kavi@example.com", fullName: null },
      payment: {
        id: "a9f73442-5c5d-451b-b74e-f1cef8c261e8",
        status: PaymentStatus.PAID,
        verifiedAt: new Date("2026-05-31T08:02:00.000Z"),
        createdAt: new Date("2026-05-31T08:00:00.000Z")
      },
      items: [{
        id: "f4f5c74b-f0bc-41a5-b477-585c618b5598",
        name: "Heritage Filter Coffee",
        variantName: "250 g",
        unitDisplay: "250 g",
        quantity: 2,
        unitPrice: "40",
        unitPricePaise: 4000n,
        total: "80",
        totalPaise: 8000n,
        product: { imageUrl: "https://cdn.example.com/coffee.jpg", sku: "COF-250" },
        variant: { sku: "COF-250-A" }
      }],
      stateTransitions: []
    });

    await expect(service.order(auth, "8a516745-963d-4d54-9925-921f4f4ef041")).resolves.toMatchObject({
      apiVersion: "v1",
      order: {
        id: "8a516745-963d-4d54-9925-921f4f4ef041",
        lineItems: [expect.objectContaining({
          name: "Heritage Filter Coffee",
          quantity: 2,
          total: 80,
          imageUrl: "https://cdn.example.com/coffee.jpg",
          sku: "COF-250-A"
        })]
      }
    });
    expect(prisma.order.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: "8a516745-963d-4d54-9925-921f4f4ef041",
        storeId: "store-1"
      }
    }));
  });

  it("does not expose another store's order through a deep link", async () => {
    const { prisma, service } = serviceWithMembership({
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
    prisma.order.findFirst.mockResolvedValue(null);

    await expect(service.order(auth, "8a516745-963d-4d54-9925-921f4f4ef041")).rejects.toBeInstanceOf(NotFoundException);
  });
});
