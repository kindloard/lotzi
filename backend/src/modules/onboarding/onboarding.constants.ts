import {
  OnboardingLifecycleState,
  OnboardingStep,
  StoreMediaKind
} from "@prisma/client";

export const ONBOARDING_STEPS = [
  OnboardingStep.BUSINESS,
  OnboardingStep.BRANDING,
  OnboardingStep.LEGAL,
  OnboardingStep.LOCATION,
  OnboardingStep.PREFERENCES,
  OnboardingStep.REVIEW
] as const;

export const ONBOARDING_STEP_ORDER: Record<OnboardingStep, number> = {
  [OnboardingStep.BUSINESS]: 0,
  [OnboardingStep.BRANDING]: 1,
  [OnboardingStep.LEGAL]: 2,
  [OnboardingStep.LOCATION]: 3,
  [OnboardingStep.PREFERENCES]: 4,
  [OnboardingStep.REVIEW]: 5
};

export const ONBOARDING_STATE_ORDER: Record<OnboardingLifecycleState, number> = {
  [OnboardingLifecycleState.PENDING]: 0,
  [OnboardingLifecycleState.BUSINESS_DONE]: 1,
  [OnboardingLifecycleState.BRANDING_DONE]: 2,
  [OnboardingLifecycleState.LEGAL_DONE]: 3,
  [OnboardingLifecycleState.LOCATION_DONE]: 4,
  [OnboardingLifecycleState.PREFS_DONE]: 5,
  [OnboardingLifecycleState.READY_FOR_REVIEW]: 6,
  [OnboardingLifecycleState.LAUNCHED]: 7,
  [OnboardingLifecycleState.APPROVAL_PENDING]: 8,
  [OnboardingLifecycleState.ACTIVE]: 9,
  [OnboardingLifecycleState.SUSPENDED]: 10
};

export const STEP_COMPLETION: Record<
  OnboardingStep,
  {
    completedAtField:
      | "businessCompletedAt"
      | "brandingCompletedAt"
      | "legalCompletedAt"
      | "locationCompletedAt"
      | "preferencesCompletedAt"
      | "reviewReadyAt";
    completionPercent: number;
    nextStep: OnboardingStep;
    state: OnboardingLifecycleState;
  }
> = {
  [OnboardingStep.BUSINESS]: {
    completedAtField: "businessCompletedAt",
    completionPercent: 17,
    nextStep: OnboardingStep.BRANDING,
    state: OnboardingLifecycleState.BUSINESS_DONE
  },
  [OnboardingStep.BRANDING]: {
    completedAtField: "brandingCompletedAt",
    completionPercent: 33,
    nextStep: OnboardingStep.LEGAL,
    state: OnboardingLifecycleState.BRANDING_DONE
  },
  [OnboardingStep.LEGAL]: {
    completedAtField: "legalCompletedAt",
    completionPercent: 50,
    nextStep: OnboardingStep.LOCATION,
    state: OnboardingLifecycleState.LEGAL_DONE
  },
  [OnboardingStep.LOCATION]: {
    completedAtField: "locationCompletedAt",
    completionPercent: 67,
    nextStep: OnboardingStep.PREFERENCES,
    state: OnboardingLifecycleState.LOCATION_DONE
  },
  [OnboardingStep.PREFERENCES]: {
    completedAtField: "preferencesCompletedAt",
    completionPercent: 83,
    nextStep: OnboardingStep.REVIEW,
    state: OnboardingLifecycleState.PREFS_DONE
  },
  [OnboardingStep.REVIEW]: {
    completedAtField: "reviewReadyAt",
    completionPercent: 100,
    nextStep: OnboardingStep.REVIEW,
    state: OnboardingLifecycleState.READY_FOR_REVIEW
  }
};

export const MEDIA_LIMITS: Record<StoreMediaKind, { maxBytes: number; minWidth: number; minHeight: number }> = {
  [StoreMediaKind.LOGO]: { maxBytes: 3 * 1024 * 1024, minWidth: 128, minHeight: 128 },
  [StoreMediaKind.BANNER]: { maxBytes: 6 * 1024 * 1024, minWidth: 0, minHeight: 0 }
};

export const ALLOWED_MEDIA_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
