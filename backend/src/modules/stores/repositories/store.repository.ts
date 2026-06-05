import { Injectable } from "@nestjs/common";
import { Prisma, StoreStatus } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { publicStoreCode } from "../../../common/public-catalog-route";
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
    const id = randomUUID();
    return tx.store.create({
      data: {
        id,
        createdByUserId: input.createdByUserId,
        name: input.name,
        publicCode: publicStoreCode(id),
        slug: input.slug,
        phone: input.phone,
        email: input.email,
        status: StoreStatus.PENDING
      }
    });
  }
}
