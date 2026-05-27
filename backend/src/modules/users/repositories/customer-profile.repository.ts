import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../database/prisma.service";

@Injectable()
export class CustomerProfileRepository {
  constructor(readonly prisma: PrismaService) {}

  ensure(
    input: { userId: string; displayName?: string | null; phone?: string | null },
    tx: Prisma.TransactionClient = this.prisma
  ) {
    return tx.customerProfile.upsert({
      where: { userId: input.userId },
      update: {
        displayName: input.displayName ?? undefined,
        phone: input.phone ?? undefined
      },
      create: {
        userId: input.userId,
        displayName: input.displayName,
        phone: input.phone
      }
    });
  }
}
