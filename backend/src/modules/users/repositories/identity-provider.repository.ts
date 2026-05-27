import { Injectable } from "@nestjs/common";
import { IdentityProviderName, Prisma } from "@prisma/client";
import { PrismaService } from "../../../database/prisma.service";

@Injectable()
export class IdentityProviderRepository {
  constructor(readonly prisma: PrismaService) {}

  findByProviderUserId(
    provider: IdentityProviderName,
    providerUserId: string,
    tx: Prisma.TransactionClient = this.prisma
  ) {
    return tx.identityProvider.findUnique({
      where: {
        provider_providerUserId: {
          provider,
          providerUserId
        }
      },
      include: { user: true }
    });
  }

  linkGoogle(
    input: {
      userId: string;
      providerEmail: string;
      providerUserId: string;
      metadata?: Prisma.InputJsonValue;
    },
    tx: Prisma.TransactionClient = this.prisma
  ) {
    return tx.identityProvider.create({
      data: {
        userId: input.userId,
        provider: IdentityProviderName.GOOGLE,
        providerUserId: input.providerUserId,
        providerEmail: input.providerEmail,
        metadata: input.metadata ?? {}
      }
    });
  }

  markLogin(id: string, tx: Prisma.TransactionClient = this.prisma) {
    return tx.identityProvider.update({
      where: { id },
      data: { lastLoginAt: new Date() }
    });
  }
}
