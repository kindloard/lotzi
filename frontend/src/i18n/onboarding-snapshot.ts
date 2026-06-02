import type { OnboardingPayload, OnboardingStep } from "@/lib/merchant-onboarding-api";

const snapshotKey = "lotzi:onboarding-locale-switch";
const ttlMs = 30 * 60 * 1000;

export const beforeLocaleSwitchEvent = "lotzi:before-locale-switch";

export interface OnboardingLocaleSnapshot {
  createdAt: number;
  currentStep: OnboardingStep;
  values: Record<OnboardingStep, OnboardingPayload>;
}

export function writeOnboardingLocaleSnapshot(snapshot: Omit<OnboardingLocaleSnapshot, "createdAt">) {
  if (typeof sessionStorage === "undefined") {
    return;
  }
  sessionStorage.setItem(snapshotKey, JSON.stringify({ ...snapshot, createdAt: Date.now() }));
}

export function readOnboardingLocaleSnapshot() {
  if (typeof sessionStorage === "undefined") {
    return null;
  }
  try {
    const raw = sessionStorage.getItem(snapshotKey);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as OnboardingLocaleSnapshot;
    if (!parsed.createdAt || Date.now() - parsed.createdAt > ttlMs) {
      clearOnboardingLocaleSnapshot();
      return null;
    }
    return parsed;
  } catch {
    clearOnboardingLocaleSnapshot();
    return null;
  }
}

export function clearOnboardingLocaleSnapshot() {
  if (typeof sessionStorage !== "undefined") {
    sessionStorage.removeItem(snapshotKey);
  }
}
