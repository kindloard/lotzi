import {
  OnboardingLifecycleState,
  OnboardingStep,
  StoreApprovalStatus,
  StoreStatus
} from "@prisma/client";
import { AdminApprovalsService } from "../../modules/admin/admin-approvals.service";

const pendingReview = {
  id: "review-1",
  storeId: "store-1",
  status: StoreApprovalStatus.PENDING,
  riskScore: 20,
  reasonCodes: ["new_merchant"],
  reviewedAt: null,
  createdAt: new Date("2026-05-23T10:00:00Z"),
  store: {
    id: "store-1",
    status: StoreStatus.PENDING,
    deletedAt: null,
    createdBy: {
      id: "user-1",
      email: "owner@example.com",
      fullName: "Owner",
      authzVersion: 3
    },
    onboardingState: {
      state: OnboardingLifecycleState.APPROVAL_PENDING,
      currentStep: OnboardingStep.REVIEW,
      completionPercent: 100,
      version: 4,
      reviewReadyAt: new Date("2026-05-23T09:50:00Z"),
      launchedAt: new Date("2026-05-23T09:55:00Z"),
      approvalSubmittedAt: new Date("2026-05-23T10:00:00Z")
    }
  }
};

function serviceWithTx(tx: Record<string, unknown>) {
  const prisma = {
    $transaction: jest.fn(async (callback: (txArg: typeof tx) => Promise<unknown>) => callback(tx))
  };
  const authStateInvalidator = {
    invalidateUserVersions: jest.fn()
  };
  const shops = {
    invalidateShopCaches: jest.fn()
  };
  return {
    prisma,
    authStateInvalidator,
    shops,
    service: new AdminApprovalsService(prisma as never, authStateInvalidator as never, shops as never)
  };
}

describe("AdminApprovalsService", () => {
  it("approves a pending merchant by updating store, state, review, and event atomically", async () => {
    const tx = {
      storeApprovalReview: {
        findUnique: jest.fn(async () => pendingReview),
        update: jest.fn(async () => ({ status: StoreApprovalStatus.AUTO_APPROVED }))
      },
      storeOnboardingState: {
        upsert: jest.fn(async () => ({
          state: OnboardingLifecycleState.ACTIVE,
          currentStep: OnboardingStep.REVIEW,
          completionPercent: 100,
          version: 5
        }))
      },
      store: {
        update: jest.fn(async () => ({ status: StoreStatus.APPROVED }))
      },
      domainEvent: {
        create: jest.fn(async () => undefined)
      }
    };
    const { service } = serviceWithTx(tx);

    await expect(service.approve("store-1")).resolves.toMatchObject({
      storeId: "store-1",
      status: StoreStatus.APPROVED,
      reviewStatus: StoreApprovalStatus.AUTO_APPROVED,
      state: {
        lifecycle: OnboardingLifecycleState.ACTIVE
      }
    });

    expect(tx.store.update).toHaveBeenCalledWith({
      where: { id: "store-1" },
      data: expect.objectContaining({
        status: StoreStatus.APPROVED,
        rejectionReason: null
      })
    });
    expect(tx.storeOnboardingState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          state: OnboardingLifecycleState.ACTIVE,
          version: { increment: 1 }
        })
      })
    );
    expect(tx.domainEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: "merchant.approval.approved",
          aggregateId: "store-1"
        })
      })
    );
  });

  it("rejects a pending merchant with an audit reason", async () => {
    const tx = {
      storeApprovalReview: {
        findUnique: jest.fn(async () => pendingReview),
        update: jest.fn(async () => ({ status: StoreApprovalStatus.REJECTED }))
      },
      storeOnboardingState: {
        upsert: jest.fn(async () => ({
          state: OnboardingLifecycleState.SUSPENDED,
          currentStep: OnboardingStep.REVIEW,
          completionPercent: 100,
          version: 5
        }))
      },
      store: {
        update: jest.fn(async () => ({ status: StoreStatus.REJECTED }))
      },
      domainEvent: {
        create: jest.fn(async () => undefined)
      }
    };
    const { service } = serviceWithTx(tx);

    await expect(service.reject("store-1", { reason: "Documents mismatch" })).resolves.toMatchObject({
      storeId: "store-1",
      status: StoreStatus.REJECTED,
      reviewStatus: StoreApprovalStatus.REJECTED,
      state: {
        lifecycle: OnboardingLifecycleState.SUSPENDED
      }
    });

    expect(tx.store.update).toHaveBeenCalledWith({
      where: { id: "store-1" },
      data: {
        status: StoreStatus.REJECTED,
        rejectionReason: "Documents mismatch"
      }
    });
    expect(tx.storeApprovalReview.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reasonCodes: ["new_merchant", "admin_rejected"]
        })
      })
    );
  });
});
