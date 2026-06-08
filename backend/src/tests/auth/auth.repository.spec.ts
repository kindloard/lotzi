import { OtpPurpose, OutboxStatus } from "@prisma/client";
import { AuthRepository } from "../../modules/auth/auth.repository";

describe("AuthRepository signup OTP delivery gates", () => {
  it("creates a fresh OTP during cooldown when the previous email was not sent", async () => {
    const futureCooldown = new Date(Date.now() + 30_000);
    const create = jest.fn(async ({ data }) => ({
      id: "otp-new",
      cooldownUntil: data.cooldownUntil
    }));
    const tx = {
      otpVerification: {
        findFirst: jest.fn(async () => ({
          id: "otp-old",
          cooldownUntil: futureCooldown
        })),
        create
      },
      emailOutbox: {
        findUnique: jest.fn(async () => ({ status: OutboxStatus.PENDING }))
      }
    };
    const repository = new AuthRepository({} as never);
    const nextCooldown = new Date(Date.now() + 60_000);

    const result = await repository.createSignupOtp(
      {
        userId: "user-1",
        email: "buyer@example.com",
        otpHash: "otp-hash",
        otpNonce: "otp-nonce",
        expiresAt: new Date(Date.now() + 10 * 60_000),
        cooldownUntil: nextCooldown,
        metadata: { accountType: "CUSTOMER" }
      },
      tx as never
    );

    expect(tx.emailOutbox.findUnique).toHaveBeenCalledWith({
      where: { idempotencyKey: "signup-otp:otp-old" },
      select: { status: true }
    });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: "buyer@example.com",
        otpHash: "otp-hash",
        otpNonce: "otp-nonce",
        purpose: OtpPurpose.EMAIL_SIGNUP,
        cooldownUntil: nextCooldown
      })
    });
    expect(result).toEqual({
      otpId: "otp-new",
      cooldownUntil: nextCooldown,
      sent: true
    });
  });

  it("keeps cooldown when the previous OTP email was sent", async () => {
    const futureCooldown = new Date(Date.now() + 30_000);
    const create = jest.fn();
    const tx = {
      otpVerification: {
        findFirst: jest.fn(async () => ({
          id: "otp-old",
          cooldownUntil: futureCooldown
        })),
        create
      },
      emailOutbox: {
        findUnique: jest.fn(async () => ({ status: OutboxStatus.SENT }))
      }
    };
    const repository = new AuthRepository({} as never);

    const result = await repository.createSignupOtp(
      {
        userId: "user-1",
        email: "buyer@example.com",
        otpHash: "otp-hash",
        otpNonce: "otp-nonce",
        expiresAt: new Date(Date.now() + 10 * 60_000),
        cooldownUntil: new Date(Date.now() + 60_000)
      },
      tx as never
    );

    expect(create).not.toHaveBeenCalled();
    expect(result).toEqual({
      otpId: "otp-old",
      cooldownUntil: futureCooldown,
      sent: false
    });
  });
});
