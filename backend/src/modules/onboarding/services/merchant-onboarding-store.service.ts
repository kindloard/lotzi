import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import {
  OnboardingLifecycleState,
  OnboardingStep,
  Prisma,
  StoreMemberStatus,
  StoreStatus
} from "@prisma/client";
import { PrismaService } from "../../../database/prisma.service";
import { ROLE_CODES } from "../../rbac/permissions";
import { AuthenticatedPrincipal } from "../../auth/auth.types";

@Injectable()
export class MerchantOnboardingStoreService {
  constructor(private readonly prisma: PrismaService) {}

  async requireCurrentStore(
    auth: AuthenticatedPrincipal,
    tx: Prisma.TransactionClient = this.prisma
  ) {
    const store = await tx.store.findFirst({
      where: {
        createdByUserId: auth.userId,
        deletedAt: null,
        status: { in: [StoreStatus.PENDING, StoreStatus.APPROVED] },
        members: {
          some: {
            userId: auth.userId,
            status: StoreMemberStatus.ACTIVE,
            role: {
              code: ROLE_CODES.MERCHANT_OWNER
            }
          }
        }
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        createdByUserId: true
      }
    });

    if (!store) {
      if (!auth.roleCodes.includes(ROLE_CODES.MERCHANT_OWNER)) {
        throw new ForbiddenException("Merchant onboarding is only available to merchant owners.");
      }
      throw new NotFoundException("No merchant store is ready for onboarding.");
    }

    return store;
  }

  async ensureState(storeId: string, tx: Prisma.TransactionClient = this.prisma) {
    const existing = await tx.storeOnboardingState.findUnique({ where: { storeId } });
    if (existing) {
      return { state: existing, created: false };
    }

    const state = await tx.storeOnboardingState.create({
      data: {
        storeId,
        state: OnboardingLifecycleState.PENDING,
        currentStep: OnboardingStep.BUSINESS,
        completionPercent: 0
      }
    });

    return { state, created: true };
  }
}
