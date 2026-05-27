import { Injectable } from "@nestjs/common";
import { Prisma, StoreApprovalStatus } from "@prisma/client";
import { PrismaService } from "../../../database/prisma.service";

@Injectable()
export class ApprovalService {
  constructor(private readonly prisma: PrismaService) {}

  ensurePendingReview(
    storeId: string,
    tx: Prisma.TransactionClient = this.prisma
  ) {
    return tx.storeApprovalReview.upsert({
      where: {
        storeId
      },
      create: {
        storeId,
        status: StoreApprovalStatus.PENDING,
        riskScore: 20,
        reasonCodes: ["new_merchant"]
      },
      update: {
        status: StoreApprovalStatus.PENDING,
        riskScore: 20,
        reasonCodes: ["new_merchant"]
      }
    });
  }
}
