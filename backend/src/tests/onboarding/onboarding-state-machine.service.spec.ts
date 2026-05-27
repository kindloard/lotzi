import { BadRequestException } from "@nestjs/common";
import { OnboardingLifecycleState, OnboardingStep } from "@prisma/client";
import { OnboardingStateMachine } from "../../modules/onboarding/services/onboarding-state-machine.service";

describe("OnboardingStateMachine", () => {
  const machine = new OnboardingStateMachine();

  it("advances merchant onboarding through explicit lifecycle states", () => {
    expect(machine.completeStep(OnboardingLifecycleState.PENDING, OnboardingStep.BUSINESS)).toMatchObject({
      state: OnboardingLifecycleState.BUSINESS_DONE,
      currentStep: OnboardingStep.BRANDING,
      completionPercent: 17
    });
    expect(machine.completeStep(OnboardingLifecycleState.LEGAL_DONE, OnboardingStep.LOCATION)).toMatchObject({
      state: OnboardingLifecycleState.LOCATION_DONE,
      currentStep: OnboardingStep.PREFERENCES,
      completionPercent: 67
    });
    expect(machine.completeStep(OnboardingLifecycleState.LOCATION_DONE, OnboardingStep.PREFERENCES)).toMatchObject({
      state: OnboardingLifecycleState.PREFS_DONE,
      currentStep: OnboardingStep.REVIEW,
      completionPercent: 83
    });
    expect(machine.completeStep(OnboardingLifecycleState.PREFS_DONE, OnboardingStep.REVIEW)).toMatchObject({
      state: OnboardingLifecycleState.READY_FOR_REVIEW,
      currentStep: OnboardingStep.REVIEW,
      completionPercent: 100
    });
  });

  it("allows review submission from the visible review step", () => {
    expect(() => machine.assertCanLaunch(OnboardingLifecycleState.LOCATION_DONE)).toThrow(BadRequestException);
    expect(machine.assertCanLaunch(OnboardingLifecycleState.PREFS_DONE)).toBe("launch");
    expect(machine.assertCanLaunch(OnboardingLifecycleState.READY_FOR_REVIEW)).toBe("launch");
    expect(machine.assertCanLaunch(OnboardingLifecycleState.APPROVAL_PENDING)).toBe("already-launched");
  });

  it("prevents skipping required onboarding states", () => {
    expect(() =>
      machine.completeStep(OnboardingLifecycleState.PENDING, OnboardingStep.LEGAL)
    ).toThrow(BadRequestException);
    expect(() =>
      machine.completeStep(OnboardingLifecycleState.LEGAL_DONE, OnboardingStep.PREFERENCES)
    ).toThrow(BadRequestException);
  });

  it("allows idempotent re-completion without moving a later lifecycle backward", () => {
    expect(machine.completeStep(OnboardingLifecycleState.PREFS_DONE, OnboardingStep.LOCATION)).toMatchObject({
      state: OnboardingLifecycleState.PREFS_DONE,
      currentStep: undefined,
      completionPercent: undefined,
      completedAtField: "locationCompletedAt"
    });
  });
});
