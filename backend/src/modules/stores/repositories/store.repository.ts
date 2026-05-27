import { Injectable } from "@nestjs/common";
import { Prisma, StoreStatus } from "@prisma/client";
import { PrismaService } from "../../../database/prisma.service";

@Injectable()
export class StoreRepository {
  constructor(readonly prisma: PrismaService) {}

  findById(id: string, tx: Prisma.TransactionClient = this.prisma) {
    return tx.store.findUnique({ where: { id } });
  }

  findBySlug(slug: string, tx: Prisma.TransactionClient = this.prisma) {
    return tx.store.findUnique({ where: { slug } });
  }

  findPendingByCreatorAndName(
    createdByUserId: string,
    name: string,
    tx: Prisma.TransactionClient = this.prisma
  ) {
    return tx.store.findFirst({
      where: {
        createdByUserId,
        name,
        status: StoreStatus.PENDING,
        deletedAt: null
      }
    });
  }

  createPending(
    input: {
      createdByUserId: string;
      name: string;
      slug: string;
      phone?: string | null;
      email?: string | null;
    },
    tx: Prisma.TransactionClient = this.prisma
  ) {
    return tx.store.create({
      data: {
        createdByUserId: input.createdByUserId,
        name: input.name,
        slug: input.slug,
        phone: input.phone,
        email: input.email,
        status: StoreStatus.PENDING
      }
    });
  }
}
