import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import {
  OnboardingLifecycleState,
  OnboardingStep,
  Prisma,
  StoreApprovalStatus,
  StoreStatus
} from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { AuthStateInvalidator } from "../rbac/auth-state-invalidator.service";
import { ShopsService } from "../shops/shops.service";
import { AdminApprovalDecisionDto, AdminRejectionDto } from "./dto/admin-approval.dto";

const approvalStoreInclude = {
  createdBy: {
    select: {
      id: true,
      email: true,
      fullName: true,
      authzVersion: true
    }
  },
  businessProfile: true,
  branding: {
    include: {
      logoMedia: true,
      bannerMedia: true
    }
  },
  settings: true,
  onboardingState: true
} satisfies Prisma.StoreInclude;

const approvalReviewInclude = {
  store: {
    include: approvalStoreInclude
  }
} satisfies Prisma.StoreApprovalReviewInclude;

type ApprovalReviewAggregate = Prisma.StoreApprovalReviewGetPayload<{
  include: typeof approvalReviewInclude;
}>;

@Injectable()
export class AdminApprovalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authStateInvalidator: AuthStateInvalidator,
    private readonly shops: ShopsService
  ) {}

  async listPending() {
    const [reviews, pendingCount, approvedCount, rejectedCount] = await this.prisma.$transaction([
      this.prisma.storeApprovalReview.findMany({
        where: {
          status: StoreApprovalStatus.PENDING,
          store: {
            deletedAt: null,
            status: StoreStatus.PENDING,
            onboardingState: {
              state: OnboardingLifecycleState.APPROVAL_PENDING
            }
          }
        },
        include: approvalReviewInclude,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: 100
      }),
      this.prisma.storeApprovalReview.count({
        where: { status: StoreApprovalStatus.PENDING }
      }),
      this.prisma.store.count({
        where: { status: StoreStatus.APPROVED, deletedAt: null }
      }),
      this.prisma.storeApprovalReview.count({
        where: { status: StoreApprovalStatus.REJECTED }
      })
    ]);

    return {
      summary: {
        pending: pendingCount,
        approved: approvedCount,
        rejected: rejectedCount
      },
      reviews: reviews.map((review) => this.toReview(review))
    };
  }

  async approve(storeId: string, dto: AdminApprovalDecisionDto = {}) {
    const note = optionalTrimmed(dto.note);
    const result = await this.prisma.$transaction(async (tx) => {
      const review = await this.requirePendingReview(storeId, tx);
      const now = new Date();
      const updatedReview = await tx.storeApprovalReview.update({
        where: { storeId },
        data: {
          status: StoreApprovalStatus.AUTO_APPROVED,
          reviewedAt: now,
          reasonCodes: normalizeReasonCodes(review.reasonCodes)
        }
      });
      const state = await tx.storeOnboardingState.upsert({
        where: { storeId },
        create: {
          storeId,
          state: OnboardingLifecycleState.ACTIVE,
          currentStep: OnboardingStep.REVIEW,
          completionPercent: 100,
          reviewReadyAt: review.store.onboardingState?.reviewReadyAt ?? now,
          launchedAt: review.store.onboardingState?.launchedAt ?? now,
          approvalSubmittedAt: review.store.onboardingState?.approvalSubmittedAt ?? now
        },
        update: {
          state: OnboardingLifecycleState.ACTIVE,
          currentStep: OnboardingStep.REVIEW,
          completionPercent: 100,
          version: { increment: 1 }
        }
      });
      const store = await tx.store.update({
        where: { id: storeId },
        data: {
          status: StoreStatus.APPROVED,
          approvedAt: now,
          rejectionReason: null
        }
      });
      await tx.domainEvent.create({
        data: {
          eventType: "merchant.approval.approved",
          aggregateType: "store",
          aggregateId: storeId,
          payload: {
            source: "admin_password_panel",
            note: note ?? null,
            reviewedAt: now.toISOString()
          }
        }
      });

      return {
        ownerUserId: review.store.createdBy.id,
        ownerAuthzVersion: review.store.createdBy.authzVersion,
        storeId,
        status: store.status,
        reviewStatus: updatedReview.status,
        state: {
          lifecycle: state.state,
          currentStep: state.currentStep,
          completionPercent: state.completionPercent,
          version: state.version
        },
        reviewedAt: now.toISOString()
      };
    });
    void this.authStateInvalidator.invalidateUserVersions(result.ownerUserId, [
      result.ownerAuthzVersion
    ]);
    await this.shops.invalidateShopCaches({
      keyFamily: "all",
      operation: "admin.approval.approve",
      storeId: result.storeId
    });
    const { ownerUserId: _ownerUserId, ownerAuthzVersion: _ownerAuthzVersion, ...response } = result;
    return response;
  }

  async reject(storeId: string, dto: AdminRejectionDto) {
    const reason = optionalTrimmed(dto.reason);
    if (!reason) {
      throw new BadRequestException("A rejection reason is required.");
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const review = await this.requirePendingReview(storeId, tx);
      const now = new Date();
      const updatedReview = await tx.storeApprovalReview.update({
        where: { storeId },
        data: {
          status: StoreApprovalStatus.REJECTED,
          reviewedAt: now,
          reasonCodes: uniqueStrings([...normalizeReasonCodes(review.reasonCodes), "admin_rejected"])
        }
      });
      const state = await tx.storeOnboardingState.upsert({
        where: { storeId },
        create: {
          storeId,
          state: OnboardingLifecycleState.SUSPENDED,
          currentStep: OnboardingStep.REVIEW,
          completionPercent: 100,
          reviewReadyAt: review.store.onboardingState?.reviewReadyAt ?? now,
          launchedAt: review.store.onboardingState?.launchedAt ?? now,
          approvalSubmittedAt: review.store.onboardingState?.approvalSubmittedAt ?? now
        },
        update: {
          state: OnboardingLifecycleState.SUSPENDED,
          currentStep: OnboardingStep.REVIEW,
          version: { increment: 1 }
        }
      });
      const store = await tx.store.update({
        where: { id: storeId },
        data: {
          status: StoreStatus.REJECTED,
          rejectionReason: reason
        }
      });
      await tx.domainEvent.create({
        data: {
          eventType: "merchant.approval.rejected",
          aggregateType: "store",
          aggregateId: storeId,
          payload: {
            source: "admin_password_panel",
            reason,
            reviewedAt: now.toISOString()
          }
        }
      });

      return {
        ownerUserId: review.store.createdBy.id,
        ownerAuthzVersion: review.store.createdBy.authzVersion,
        storeId,
        status: store.status,
        reviewStatus: updatedReview.status,
        state: {
          lifecycle: state.state,
          currentStep: state.currentStep,
          completionPercent: state.completionPercent,
          version: state.version
        },
        reviewedAt: now.toISOString()
      };
    });
    void this.authStateInvalidator.invalidateUserVersions(result.ownerUserId, [
      result.ownerAuthzVersion
    ]);
    await this.shops.invalidateShopCaches({
      keyFamily: "all",
      operation: "admin.approval.reject",
      storeId: result.storeId
    });
    const { ownerUserId: _ownerUserId, ownerAuthzVersion: _ownerAuthzVersion, ...response } = result;
    return response;
  }

  private async requirePendingReview(storeId: string, tx: Prisma.TransactionClient) {
    const review = await tx.storeApprovalReview.findUnique({
      where: { storeId },
      include: approvalReviewInclude
    });

    if (!review || review.store.deletedAt) {
      throw new NotFoundException("Merchant approval review was not found.");
    }

    if (review.status !== StoreApprovalStatus.PENDING || review.store.status !== StoreStatus.PENDING) {
      throw new ConflictException("Merchant approval review is no longer pending.");
    }

    return review;
  }

  private toReview(review: ApprovalReviewAggregate) {
    const store = review.store;
    const profile = store.businessProfile;
    const branding = store.branding;
    const onboarding = store.onboardingState;

    return {
      id: review.id,
      storeId: review.storeId,
      status: review.status,
      riskScore: review.riskScore,
      reasonCodes: normalizeReasonCodes(review.reasonCodes),
      submittedAt: iso(review.createdAt),
      reviewedAt: iso(review.reviewedAt),
      store: {
        id: store.id,
        name: store.name,
        slug: store.slug,
        status: store.status,
        phone: store.phone,
        email: store.email,
        owner: store.createdBy,
        address: {
          line: store.addressLine,
          city: store.city,
          state: store.state,
          pincode: store.pincode,
          latitude: decimalToNumber(store.latitude),
          longitude: decimalToNumber(store.longitude)
        },
        business: profile
          ? {
              businessName: profile.businessName,
              category: profile.category,
              businessType: profile.businessType,
              country: profile.country,
              legalName: profile.legalName,
              taxId: profile.taxId,
              gstin: profile.gstin,
              registrationNumber: profile.registrationNumber,
              contactEmail: profile.contactEmail,
              phone: profile.phone,
              verificationStatus: profile.verificationStatus
            }
          : null,
        branding: branding
          ? {
              tagline: branding.tagline,
              description: branding.description,
              primaryColor: branding.primaryColor,
              accentColor: branding.accentColor,
              logoUrl: branding.logoMedia?.url ?? null,
              bannerUrl: branding.bannerMedia?.url ?? null
            }
          : null,
        settings: store.settings
          ? {
              businessHours: store.settings.businessHours
            }
          : null,
        onboarding: onboarding
          ? {
              lifecycle: onboarding.state,
              currentStep: onboarding.currentStep,
              completionPercent: onboarding.completionPercent,
              version: onboarding.version,
              approvalSubmittedAt: iso(onboarding.approvalSubmittedAt)
            }
          : null
      }
    };
  }
}

function normalizeReasonCodes(value: Prisma.JsonValue): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values));
}

function optionalTrimmed(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function decimalToNumber(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function iso(value?: Date | null) {
  return value ? value.toISOString() : null;
}
