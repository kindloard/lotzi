import {
  CheckoutOnboardingFlowStatus,
  PhoneOtpStatus,
  PrismaClient
} from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const now = new Date();
  const retentionDays = Number.parseInt(process.env.CHECKOUT_ONBOARDING_CLEANUP_RETENTION_DAYS ?? "7", 10);
  const cutoff = new Date(now.getTime() - Math.max(1, retentionDays) * 24 * 60 * 60 * 1000);

  const [expiredFlows, expiredOtps, deletedOtps, deletedFlows] = await prisma.$transaction([
    prisma.checkoutOnboardingFlow.updateMany({
      where: {
        expiresAt: { lt: now },
        consumedAt: null,
        status: {
          in: [
            CheckoutOnboardingFlowStatus.ADDRESS_COLLECTED,
            CheckoutOnboardingFlowStatus.OTP_SENT,
            CheckoutOnboardingFlowStatus.PHONE_VERIFIED
          ]
        }
      },
      data: { status: CheckoutOnboardingFlowStatus.EXPIRED }
    }),
    prisma.phoneOtpVerification.updateMany({
      where: {
        expiresAt: { lt: now },
        status: PhoneOtpStatus.PENDING
      },
      data: { status: PhoneOtpStatus.EXPIRED }
    }),
    prisma.phoneOtpVerification.deleteMany({
      where: {
        createdAt: { lt: cutoff },
        status: {
          in: [
            PhoneOtpStatus.EXPIRED,
            PhoneOtpStatus.FAILED,
            PhoneOtpStatus.CONSUMED
          ]
        }
      }
    }),
    prisma.checkoutOnboardingFlow.deleteMany({
      where: {
        createdAt: { lt: cutoff },
        status: {
          in: [
            CheckoutOnboardingFlowStatus.EXPIRED,
            CheckoutOnboardingFlowStatus.ABANDONED,
            CheckoutOnboardingFlowStatus.COMPLETED
          ]
        }
      }
    })
  ]);

  console.log(JSON.stringify({
    cutoff: cutoff.toISOString(),
    deletedFlows: deletedFlows.count,
    deletedOtps: deletedOtps.count,
    expiredFlows: expiredFlows.count,
    expiredOtps: expiredOtps.count
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
