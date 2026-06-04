import { OnboardingLifecycleState, OnboardingStep, StoreStatus } from "@prisma/client";
import { OnboardingService } from "../../modules/onboarding/services/onboarding.service";

const rules = {
  country: "IN",
  businessType: "sole_proprietor",
  required: {
    BUSINESS: [],
    BRANDING: [],
    LEGAL: [],
    LOCATION: [],
    PREFERENCES: [],
    REVIEW: []
  },
  options: {
    businessTypes: [],
    categories: [],
    countries: []
  }
};

const authStateInvalidator = {
  invalidateUserVersions: jest.fn()
};

function rawAggregateRow(aggregate: Record<string, unknown>) {
  return {
    id: aggregate.id,
    name: aggregate.name,
    slug: aggregate.slug,
    status: aggregate.status,
    phone: aggregate.phone ?? null,
    email: aggregate.email ?? null,
    legal_name: aggregate.legalName ?? null,
    address_line: aggregate.addressLine ?? null,
    city: aggregate.city ?? null,
    state: aggregate.state ?? null,
    pincode: aggregate.pincode ?? null,
    latitude: aggregate.latitude ?? null,
    longitude: aggregate.longitude ?? null,
    business_profile: aggregate.businessProfile ?? null,
    branding: aggregate.branding ?? null,
    settings: aggregate.settings ?? null,
    onboarding_state: aggregate.onboardingState ?? null,
    onboarding_drafts: aggregate.onboardingDrafts ?? []
  };
}

describe("OnboardingService", () => {
  it("returns a lightweight completion response without reloading the aggregate", async () => {
    const aggregate = {
      id: "store-1",
      name: "Fresh Mart",
      slug: "fresh-mart",
      status: StoreStatus.PENDING,
      phone: null,
      legalName: null,
      email: null,
      addressLine: null,
      city: null,
      state: null,
      pincode: null,
      latitude: null,
      longitude: null,
      businessProfile: {
        businessName: "Fresh Mart",
        category: "grocery",
        businessType: "sole_proprietor",
        country: "IN",
        phone: "+91 9999999999"
      },
      branding: null,
      settings: null,
      onboardingState: {
        state: OnboardingLifecycleState.PENDING,
        currentStep: OnboardingStep.BUSINESS,
        completionPercent: 0,
        version: 1
      },
      onboardingDrafts: []
    };
    const tx = {
      store: { update: jest.fn(async () => undefined) },
      storeBusinessProfile: { upsert: jest.fn(async () => undefined) },
      storeOnboardingState: {
        update: jest.fn(async () => ({
          state: OnboardingLifecycleState.BUSINESS_DONE,
          currentStep: OnboardingStep.BRANDING,
          completionPercent: 17,
          version: 2
        }))
      }
    };
    const prisma = {
      store: {
        findUniqueOrThrow: jest.fn(async () => aggregate)
      },
      $queryRaw: jest.fn(async () => [rawAggregateRow(aggregate)]),
      $transaction: jest.fn(async (callback: (txArg: typeof tx) => Promise<unknown>) => callback(tx))
    };
    const stores = {
      requireCurrentStore: jest.fn(async () => ({ id: "store-1" })),
      ensureState: jest.fn(async () => ({
        state: {
          state: OnboardingLifecycleState.PENDING,
          currentStep: OnboardingStep.BUSINESS,
          completionPercent: 0,
          version: 1
        }
      }))
    };
    const drafts = {
      save: jest.fn(async () => ({
        step: OnboardingStep.BUSINESS,
        version: 4,
        validationErrors: []
      }))
    };
    const events = { enqueue: jest.fn(async () => undefined) };
    const ruleEngine = {
      rulesFor: jest.fn(() => rules),
      validateStep: jest.fn(() => [])
    };
    const stateMachine = {
      completeStep: jest.fn(() => ({
        state: OnboardingLifecycleState.BUSINESS_DONE,
        currentStep: OnboardingStep.BRANDING,
        completionPercent: 17,
        completedAtField: "businessCompletedAt"
      }))
    };
    const geoLocationWriter = {
      bumpEpochs: jest.fn(async () => undefined),
      updateStoreLocationInTransaction: jest.fn()
    };
    const service = new OnboardingService(
      prisma as never,
      stores as never,
      drafts as never,
      events as never,
      ruleEngine as never,
      stateMachine as never,
      {} as never,
      authStateInvalidator as never,
      geoLocationWriter as never
    );

    await expect(
      service.completeStep(
        { userId: "user-1" } as never,
        OnboardingStep.BUSINESS,
        {
          payload: {
            storeName: "Fresh Mart",
            category: "grocery",
            businessType: "sole_proprietor",
            country: "IN",
            phone: "+91 9999999999"
          },
          version: 3
        }
      )
    ).resolves.toEqual({
      step: OnboardingStep.BUSINESS,
      state: {
        lifecycle: OnboardingLifecycleState.BUSINESS_DONE,
        currentStep: OnboardingStep.BRANDING,
        completionPercent: 17,
        version: 2
      },
      draft: {
        step: OnboardingStep.BUSINESS,
        version: 4,
        validationErrors: []
      },
      rules
    });

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it("returns an active dashboard redirect for already approved stores", async () => {
    const aggregate = {
      id: "store-1",
      name: "Fresh Mart",
      slug: "fresh-mart",
      status: StoreStatus.APPROVED,
      businessProfile: null,
      branding: null,
      settings: null,
      onboardingState: {
        state: OnboardingLifecycleState.ACTIVE,
        currentStep: OnboardingStep.REVIEW,
        completionPercent: 100,
        version: 5
      },
      onboardingDrafts: []
    };
    const prisma = {
      store: {
        findUniqueOrThrow: jest.fn(async () => aggregate)
      },
      $queryRaw: jest.fn(async () => [rawAggregateRow(aggregate)]),
      $transaction: jest.fn()
    };
    const stores = {
      requireCurrentStore: jest.fn(async () => ({ id: "store-1" })),
      ensureState: jest.fn()
    };
    const service = new OnboardingService(
      prisma as never,
      stores as never,
      {} as never,
      {} as never,
      {} as never,
      { assertCanLaunch: jest.fn(() => "already-launched") } as never,
      {} as never,
      authStateInvalidator as never,
      { bumpEpochs: jest.fn(), updateStoreLocationInTransaction: jest.fn() } as never
    );

    await expect(
      service.launch({ userId: "user-1" } as never, { idempotencyKey: "launch-1" })
    ).resolves.toEqual({
      status: "ACTIVE",
      redirectTo: "/merchant/dashboard",
      storeId: "store-1",
      state: OnboardingLifecycleState.ACTIVE
    });

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
