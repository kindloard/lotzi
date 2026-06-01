import { PaymentSettingsEncryptionService } from "../../modules/payment-settings/encryption.service";

describe("PaymentSettingsEncryptionService", () => {
  it("encrypts and decrypts PhonePe secrets using AES-GCM envelopes", () => {
    const service = new PaymentSettingsEncryptionService({
      get: (key: string) => key === "PHONEPE_ENCRYPTION_KEY"
        ? "test-phonepe-encryption-key-minimum-32-chars"
        : undefined
    } as never);

    const encrypted = service.encrypt("client-secret-value");

    expect(encrypted).toMatch(/^v1:/);
    expect(encrypted).not.toContain("client-secret-value");
    expect(service.decrypt(encrypted)).toBe("client-secret-value");
  });
});
