import { BadRequestException, Injectable } from "@nestjs/common";
import { OnboardingLifecycleState, OnboardingStep } from "@prisma/client";
import { ONBOARDING_STATE_ORDER, STEP_COMPLETION } from "../onboarding.constants";

const requiredStateRankBeforeStep: Record<OnboardingStep, number> = {
  [OnboardingStep.BUSINESS]: ONBOARDING_STATE_ORDER[OnboardingLifecycleState.PENDING],
  [OnboardingStep.BRANDING]: ONBOARDING_STATE_ORDER[OnboardingLifecycleState.BUSINESS_DONE],
  [OnboardingStep.LEGAL]: ONBOARDING_STATE_ORDER[OnboardingLifecycleState.BRANDING_DONE],
  [OnboardingStep.LOCATION]: ONBOARDING_STATE_ORDER[OnboardingLifecycleState.LEGAL_DONE],
  [OnboardingStep.PREFERENCES]: ONBOARDING_STATE_ORDER[OnboardingLifecycleState.LOCATION_DONE],
  [OnboardingStep.REVIEW]: ONBOARDING_STATE_ORDER[OnboardingLifecycleState.PREFS_DONE]
};

@Injectable()
export class OnboardingStateMachine {
  completeStep(current: OnboardingLifecycleState, step: OnboardingStep) {
    const target = STEP_COMPLETION[step];
    if (!target) {
      throw new BadRequestException("Unsupported onboarding step.");
    }

    const currentRank = ONBOARDING_STATE_ORDER[current];
    if (currentRank < requiredStateRankBeforeStep[step]) {
      throw new BadRequestException("Complete the previous onboarding step first.");
    }

    const targetRank = ONBOARDING_STATE_ORDER[target.state];
    const shouldAdvance = currentRank <= targetRank;

    return {
      state: shouldAdvance ? target.state : current,
      currentStep: shouldAdvance ? target.nextStep : undefined,
      completionPercent: shouldAdvance ? target.completionPercent : undefined,
      completedAtField: target.completedAtField
    };
  }

  assertCanLaunch(current: OnboardingLifecycleState) {
    if (
      current === OnboardingLifecycleState.APPROVAL_PENDING ||
      current === OnboardingLifecycleState.ACTIVE ||
      current === OnboardingLifecycleState.LAUNCHED
    ) {
      return "already-launched" as const;
    }

    if (
      current !== OnboardingLifecycleState.PREFS_DONE &&
      current !== OnboardingLifecycleState.READY_FOR_REVIEW
    ) {
      throw new BadRequestException("Complete onboarding before submitting for review.");
    }

    return "launch" as const;
  }
}
