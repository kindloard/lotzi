import {
  OnboardingLifecycleState,
  OnboardingStep,
  StoreApprovalStatus,
  StoreMediaKind,
  StoreMediaStatus
} from "@prisma/client";

export type JsonRecord = Record<string, unknown>;

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface FieldRule {
  field: string;
  label: string;
  required: boolean;
  reason?: string;
  pattern?: string;
}

export interface OnboardingRules {
  country: string;
  businessType?: string;
  required: Record<OnboardingStep, FieldRule[]>;
  options: {
    businessTypes: Array<{ value: string; label: string }>;
    categories: Array<{ value: string; label: string }>;
    countries: Array<{ value: string; label: string }>;
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
    business: JsonRecord;
    branding: JsonRecord;
    legal: JsonRecord;
    location: JsonRecord;
    preferences: JsonRecord;
  };
  drafts: Partial<Record<OnboardingStep, { payload: JsonRecord; version: number; validationErrors: ValidationIssue[] }>>;
  rules: OnboardingRules;
}

export interface OnboardingStepCompletion {
  step: OnboardingStep;
  state: OnboardingBootstrap["state"];
  draft: {
    step: OnboardingStep;
    version: number;
    validationErrors: ValidationIssue[];
  };
  rules?: OnboardingRules;
}

export interface MediaAttachment {
  id: string;
  kind: StoreMediaKind;
  status: StoreMediaStatus;
  url: string;
}

export interface LaunchResult {
  status: StoreApprovalStatus | "APPROVAL_PENDING" | "ACTIVE";
  redirectTo: string;
  storeId: string;
  state: OnboardingLifecycleState;
}
