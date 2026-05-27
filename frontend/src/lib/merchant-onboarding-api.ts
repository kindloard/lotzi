import { apiFetch } from "@/lib/api";

export type OnboardingStep = "BUSINESS" | "BRANDING" | "LEGAL" | "LOCATION" | "PREFERENCES" | "REVIEW";
export type OnboardingLifecycleState =
  | "PENDING"
  | "BUSINESS_DONE"
  | "BRANDING_DONE"
  | "LEGAL_DONE"
  | "LOCATION_DONE"
  | "PREFS_DONE"
  | "READY_FOR_REVIEW"
  | "LAUNCHED"
  | "APPROVAL_PENDING"
  | "ACTIVE"
  | "SUSPENDED";

export type OnboardingPayload = Record<string, unknown>;

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface FieldRule {
  field: string;
  label: string;
  labelKey?: string;
  required: boolean;
  reason?: string;
  pattern?: string;
}

export interface OnboardingRules {
  country: string;
  businessType?: string;
  required: Record<OnboardingStep, FieldRule[]>;
  options: {
    businessTypes: Array<{ value: string; label: string; labelKey?: string }>;
    categories: Array<{ value: string; label: string; labelKey?: string }>;
    countries: Array<{ value: string; label: string; labelKey?: string }>;
  };
}

export interface OnboardingBootstrap {
  store: {
    id: string;
    name: string;
    slug: string;
    status: string;
  };
  state: {
    lifecycle: OnboardingLifecycleState;
    currentStep: OnboardingStep;
    completionPercent: number;
    version: number;
  };
  data: {
    business: OnboardingPayload;
    branding: OnboardingPayload;
    legal: OnboardingPayload;
    location: OnboardingPayload;
    preferences: OnboardingPayload;
  };
  drafts: Partial<Record<OnboardingStep, { payload: OnboardingPayload; version: number; validationErrors: ValidationIssue[] }>>;
  rules: OnboardingRules;
}

export interface OnboardingStepCompletion {
  step: OnboardingStep;
  state: OnboardingBootstrap["state"];
  draft: { step: OnboardingStep; version: number; validationErrors: ValidationIssue[] };
  rules?: OnboardingRules;
}

export interface MediaSignatureResponse {
  cloudName?: string;
  apiKey?: string;
  folder: string;
  timestamp: number;
  signature: string;
  constraints: { maxBytes: number; minWidth: number; minHeight: number };
  allowedMimeTypes: string[];
}

export interface AttachedMedia {
  id: string;
  kind: "LOGO" | "BANNER";
  status: string;
  url: string;
}

export function fetchOnboarding(options: { signal?: AbortSignal } = {}) {
  return apiFetch<OnboardingBootstrap>("/merchant/onboarding", { signal: options.signal });
}

export function saveOnboardingDraft(
  step: OnboardingStep,
  input: { payload: OnboardingPayload; version?: number },
  options: { signal?: AbortSignal } = {}
) {
  return apiFetch<{ step: OnboardingStep; payload: OnboardingPayload; version: number; validationErrors: ValidationIssue[] }>(
    `/merchant/onboarding/drafts/${step}`,
    {
      method: "PATCH",
      signal: options.signal,
      body: JSON.stringify(input)
    }
  );
}

export function completeOnboardingStep(
  step: OnboardingStep,
  input: { payload: OnboardingPayload; version?: number },
  options: { signal?: AbortSignal } = {}
) {
  return apiFetch<OnboardingStepCompletion>(`/merchant/onboarding/steps/${step}/complete`, {
    method: "POST",
    signal: options.signal,
    body: JSON.stringify(input)
  });
}

export function createMediaSignature(
  input: {
    kind: "LOGO" | "BANNER";
    fileName: string;
    mimeType: string;
    byteSize: number;
    width?: number;
    height?: number;
  },
  options: { signal?: AbortSignal } = {}
) {
  return apiFetch<MediaSignatureResponse>("/merchant/onboarding/media/signature", {
    method: "POST",
    signal: options.signal,
    body: JSON.stringify(input)
  });
}

export function attachStoreMedia(
  input: {
    kind: "LOGO" | "BANNER";
    providerPublicId: string;
    url: string;
    mimeType: string;
    byteSize: number;
    width?: number;
    height?: number;
    checksum?: string;
    idempotencyKey?: string;
  },
  options: { signal?: AbortSignal } = {}
) {
  return apiFetch<AttachedMedia>("/merchant/onboarding/media/attach", {
    method: "POST",
    signal: options.signal,
    body: JSON.stringify(input)
  });
}

export function launchOnboarding(options: { signal?: AbortSignal } = {}) {
  return apiFetch<{ status: string; redirectTo: string; storeId: string; state: OnboardingLifecycleState }>(
    "/merchant/onboarding/launch",
    {
      method: "POST",
      signal: options.signal,
      body: JSON.stringify({ idempotencyKey: crypto.randomUUID?.() ?? String(Date.now()) })
    }
  );
}
