import { Injectable } from "@nestjs/common";
import { Prisma, StoreMemberStatus } from "@prisma/client";
import { PrismaService } from "../../../database/prisma.service";

@Injectable()
export class StoreMemberRepository {
  constructor(readonly prisma: PrismaService) {}

  findActiveMembership(
    userId: string,
    storeId: string,
    tx: Prisma.TransactionClient = this.prisma
  ) {
    return tx.storeMember.findFirst({
      where: {
        userId,
        storeId,
        status: StoreMemberStatus.ACTIVE
      },
      include: { role: true }
    });
  }

  listForUser(userId: string, tx: Prisma.TransactionClient = this.prisma) {
    return tx.storeMember.findMany({
      where: {
        userId,
        status: { not: StoreMemberStatus.REMOVED }
      },
      include: {
        role: true,
        store: true
      },
      orderBy: { createdAt: "desc" }
    });
  }
}
