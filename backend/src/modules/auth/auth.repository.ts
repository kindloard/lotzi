import { Injectable } from "@nestjs/common";
import { OtpPurpose, Prisma, StoreMemberStatus } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";

export interface CreateOtpInput {
  userId: string;
  email: string;
  otpHash: string;
  otpNonce: string;
  expiresAt: Date;
  cooldownUntil: Date;
  metadata?: Prisma.InputJsonValue;
}

const latestSignupOtpSelect = Prisma.validator<Prisma.OtpVerificationSelect>()({
  id: true,
  userId: true,
  email: true,
  otpNonce: true,
  metadata: true,
  cooldownUntil: true,
  createdAt: true
});

export type LatestSignupOtp = Prisma.OtpVerificationGetPayload<{
  select: typeof latestSignupOtpSelect;
}>;

@Injectable()
export class AuthRepository {
  constructor(readonly prisma: PrismaService) {}

  findLatestSignupOtp(
    email: string,
    tx: Prisma.TransactionClient = this.prisma
  ): Promise<LatestSignupOtp | null> {
    return tx.otpVerification.findFirst({
      where: {
        email,
        purpose: OtpPurpose.EMAIL_SIGNUP,
        verified: false
      },
      orderBy: { createdAt: "desc" },
      select: latestSignupOtpSelect
    });
  }

  async createSignupOtp(
    otp: CreateOtpInput,
    tx: Prisma.TransactionClient = this.prisma
  ): Promise<{ otpId: string; cooldownUntil?: Date; sent: boolean }> {
    const latestOtp = await tx.otpVerification.findFirst({
      where: {
        userId: otp.userId,
        purpose: OtpPurpose.EMAIL_SIGNUP,
        verified: false
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        cooldownUntil: true
      }
    });

    if (latestOtp?.cooldownUntil && latestOtp.cooldownUntil > new Date()) {
      return { otpId: latestOtp.id, cooldownUntil: latestOtp.cooldownUntil, sent: false };
    }

    const created = await tx.otpVerification.create({
      data: {
        userId: otp.userId,
        email: otp.email,
        otpHash: otp.otpHash,
        otpNonce: otp.otpNonce,
        purpose: OtpPurpose.EMAIL_SIGNUP,
        metadata: otp.metadata ?? {},
        expiresAt: otp.expiresAt,
        cooldownUntil: otp.cooldownUntil
      }
    });
    return { otpId: created.id, sent: true };
  }

  async verifySignupOtp(
    userId: string,
    email: string,
    otpHash: string,
    tx: Prisma.TransactionClient = this.prisma
  ) {
    const rows = await tx.$queryRaw<
      Array<{ ok: boolean; reason: string; attempts: number }>
    >`SELECT * FROM verify_signup_otp(${userId}::uuid, ${email}::citext, ${otpHash}::text)`;
    return rows[0] ?? { ok: false, reason: "not_found", attempts: 0 };
  }

  async findActiveStoreRoleCodesForUser(
    userId: string,
    tx: Prisma.TransactionClient = this.prisma
  ) {
    const memberships = await tx.storeMember.findMany({
      where: {
        userId,
        status: StoreMemberStatus.ACTIVE,
        store: {
          deletedAt: null
        }
      },
      select: {
        role: {
          select: { code: true }
        }
      }
    });

    return memberships.map((membership) => membership.role.code);
  }
}
