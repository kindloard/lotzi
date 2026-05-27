import { ConfigService } from "@nestjs/config";
import { CryptoService } from "../../security/crypto.service";
import { OtpService } from "../../security/otp.service";

describe("OtpService", () => {
  const config = new ConfigService({
    OTP_PEPPER: "test-otp-pepper-minimum-32-characters"
  });
  const service = new OtpService(new CryptoService(config));

  it("generates a 6 digit numeric OTP", () => {
    const otp = service.generate();
    expect(otp).toMatch(/^\d{6}$/);
  });

  it("hashes OTPs with purpose, user, email, and nonce separation", () => {
    const hashA = service.hash(
      "123456",
      "user-a",
      "USER@example.com",
      "nonce-a",
      "EMAIL_SIGNUP"
    );
    const hashB = service.hash(
      "123456",
      "user-a",
      "user@example.com",
      "nonce-b",
      "EMAIL_SIGNUP"
    );
    expect(hashA).not.toEqual("123456");
    expect(hashA).not.toEqual(hashB);
  });
});
