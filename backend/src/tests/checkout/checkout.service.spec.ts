import { PaymentProvider } from "@prisma/client";
import { CheckoutService } from "../../modules/checkout/checkout.service";

function buildService({
  store = { id: "store-1", status: "APPROVED" },
  settings = []
}: {
  store?: { id: string; status: string } | null;
  settings?: Array<{
    provider: PaymentProvider;
    displayName: string | null;
    displayPriority: number;
    merchantId?: string | null;
    clientIdEncrypted?: string | null;
    clientSecretEncrypted?: string | null;
  }>;
} = {}) {
  const prisma = {
    store: {
      findFirst: jest.fn().mockResolvedValue(store)
    }
  };
  const paymentSettings = {
    isCashfreeConfigured: jest.fn().mockReturnValue(true),
    getStoreProviderSettings: jest.fn().mockResolvedValue(settings)
  };

  const service = new CheckoutService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    paymentSettings as never,
    {} as never,
    {} as never
  );

  return { service, prisma, paymentSettings };
}

describe("CheckoutService.availableMethods", () => {
  it("shows COD only when PhonePe is not connected", async () => {
    const { service } = buildService();

    await expect(service.availableMethods("store-1")).resolves.toEqual({
      apiVersion: "v1",
      methods: [
        { key: "cod", name: "Cash on Delivery", enabled: true, priority: 3 }
      ]
    });
  });

  it("shows PhonePe and COD when PhonePe is connected", async () => {
    const { service } = buildService({
      settings: [
        {
          provider: PaymentProvider.PHONEPE,
          displayName: "Store PhonePe",
          displayPriority: 2,
          merchantId: "MERCHANT",
          clientIdEncrypted: "encrypted-client-id",
          clientSecretEncrypted: "encrypted-client-secret"
        },
        { provider: PaymentProvider.COD, displayName: "Cash on Delivery", displayPriority: 3 }
      ]
    });

    await expect(service.availableMethods("store-1")).resolves.toEqual({
      apiVersion: "v1",
      methods: [
        { key: "phonepe", name: "Store PhonePe", enabled: true, priority: 2 },
        { key: "cod", name: "Cash on Delivery", enabled: true, priority: 3 }
      ]
    });
  });

  it("does not expose PhonePe when the enabled setting is incomplete", async () => {
    const { service } = buildService({
      settings: [
        { provider: PaymentProvider.PHONEPE, displayName: "Store PhonePe", displayPriority: 2 }
      ]
    });

    await expect(service.availableMethods("store-1")).resolves.toEqual({
      apiVersion: "v1",
      methods: [
        { key: "cod", name: "Cash on Delivery", enabled: true, priority: 3 }
      ]
    });
  });

  it("requires a store context before returning checkout methods", async () => {
    const { service, paymentSettings } = buildService();

    await expect(service.availableMethods()).resolves.toEqual({ apiVersion: "v1", methods: [] });
    expect(paymentSettings.isCashfreeConfigured).not.toHaveBeenCalled();
  });
});
