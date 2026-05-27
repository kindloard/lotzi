import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../database/prisma.service";

@Injectable()
export class MerchantProfileRepository {
  constructor(readonly prisma: PrismaService) {}

  ensure(
    input: { userId: string; businessName: string; legalName?: string | null },
    tx: Prisma.TransactionClient = this.prisma
  ) {
    return tx.merchantProfile.upsert({
      where: { userId: input.userId },
      update: {
        businessName: input.businessName,
        legalName: input.legalName ?? undefined
      },
      create: {
        userId: input.userId,
        businessName: input.businessName,
        legalName: input.legalName
      }
    });
  }
}
