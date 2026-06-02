import { PrismaClient, UserProviderType, UserStatus } from "@prisma/client";
import { createHmac, randomBytes } from "node:crypto";
import { validateEnv } from "../config/env";

const prisma = new PrismaClient();

function hmac(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function randomBase64Url(bytes: number): string {
  return randomBytes(bytes).toString("base64url");
}

async function main() {
  const env = validateEnv(process.env);
  const adminEmails = env.ADMIN_EMAILS.map((email) => email.toLowerCase());
  if (adminEmails.length === 0) {
    throw new Error("ADMIN_EMAILS must contain at least one email.");
  }

  for (const email of adminEmails) {
    const user = await prisma.user.upsert({
      where: { email },
      update: {
        status: UserStatus.ACTIVE,
        emailVerified: true,
        authzVersion: { increment: 1 }
      },
      create: {
        email,
        fullName: "Lotzi Admin",
        providerType: UserProviderType.EMAIL,
        status: UserStatus.ACTIVE,
        emailVerified: true
      }
    });

    await ensurePlatformRole(user.id, "PLATFORM_SUPER_ADMIN");
    await ensurePlatformRole(user.id, "CUSTOMER");

    const selector = randomBase64Url(16);
    const verifier = randomBase64Url(32);
    const nonce = randomBase64Url(16);
    const verifierHash = hmac(
      ["password_reset", selector, verifier, nonce].join(":"),
      env.PASSWORD_RESET_PEPPER
    );
    const encodedToken = encodeURIComponent(`${selector}.${verifier}`);
    const resetUrl = env.AUTH_RESET_HASH_LINKS_ENABLED
      ? `${env.FRONTEND_URL}/auth/reset-password#token=${encodedToken}`
      : `${env.FRONTEND_URL}/auth/reset-password?token=${encodedToken}`;

    await prisma.passwordReset.create({
      data: {
        userId: user.id,
        selector,
        verifierHash,
        verifierNonce: nonce,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000)
      }
    });

    await prisma.emailOutbox.create({
      data: {
        toEmail: email,
        subject: "Set up your Lotzi admin password",
        template: "admin_bootstrap_password_setup",
        payload: { resetUrl },
        idempotencyKey: `admin-bootstrap:${user.id}:${selector}`
      }
    });

    await prisma.auditLog.create({
      data: {
        eventType: "auth.admin_bootstrap.created",
        actor: "system",
        actorUserId: user.id,
        outcome: "SUCCESS",
        metadata: { email }
      }
    });

    console.log(`Admin bootstrapped for ${email}. Password setup email queued.`);
  }
}

async function ensurePlatformRole(userId: string, roleCode: string) {
  const role = await prisma.role.findUnique({ where: { code: roleCode } });
  if (!role) {
    throw new Error(`Role ${roleCode} is not seeded. Run migrations before bootstrapping admins.`);
  }

  const existing = await prisma.userRoleAssignment.findFirst({
    where: {
      userId,
      roleId: role.id,
      revokedAt: null
    }
  });
  if (!existing) {
    await prisma.userRoleAssignment.create({
      data: { userId, roleId: role.id }
    });
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
