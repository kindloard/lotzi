import { z } from "zod";
import {
  OnboardingPayload,
  OnboardingRules,
  OnboardingStep,
  ValidationIssue
} from "@/lib/merchant-onboarding-api";

type TranslationFn = (key: string, values?: Record<string, number | string>) => string;

const defaultT: TranslationFn = (key, values = {}) => {
  const fallback: Record<string, string> = {
    "validation.email": "Enter a valid email address.",
    "validation.phone": "Enter a valid Indian mobile number.",
    "validation.postalCode": "Enter a valid 6-digit PIN code.",
    "validation.required": "{field} is required."
  };
  let template = fallback[key] ?? key;
  for (const [name, value] of Object.entries(values)) {
    template = template.replaceAll(`{${name}}`, String(value));
  }
  return template;
};

function createStepSchemas(t: TranslationFn = defaultT): Record<OnboardingStep, z.ZodTypeAny> {
  const businessSchema = z.object({
    storeName: z.string().trim().min(2, t("validation.required", { field: "Store name" })).max(160),
    category: z.string().trim().min(1, t("validation.required", { field: "Category" })),
    businessType: z.string().trim().min(1, t("validation.required", { field: "Business type" })),
    country: z.string().trim().min(2, t("validation.required", { field: "Country" })),
    phone: z.string().trim().regex(/^\+91 \d{10}$/, t("validation.phone"))
  });

  const brandingSchema = z.object({
    logoUrl: z.string().trim().optional().or(z.literal("")),
    bannerUrl: z.string().trim().optional().or(z.literal("")),
    tagline: z.string().trim().max(100).optional().or(z.literal("")),
    description: z.string().trim().max(250).optional().or(z.literal(""))
  });

  const legalSchema = z.object({
    legalName: z.string().trim().optional().or(z.literal("")),
    taxId: z.string().trim().optional().or(z.literal("")),
    gstin: z.string().trim().optional().or(z.literal("")),
    registrationNumber: z.string().trim().optional().or(z.literal("")),
    addressLine: z.string().trim().optional().or(z.literal("")),
    city: z.string().trim().optional().or(z.literal("")),
    state: z.string().trim().optional().or(z.literal("")),
    pincode: z.string().trim().optional().or(z.literal("")),
    contactEmail: z.string().trim().email(t("validation.email")).optional().or(z.literal(""))
  });

  const locationSchema = z.object({
    latitude: z.number().finite("Latitude must be a finite number.").min(-90, "Latitude must be between -90 and 90.").max(90, "Latitude must be between -90 and 90."),
    longitude: z.number().finite("Longitude must be a finite number.").min(-180, "Longitude must be between -180 and 180.").max(180, "Longitude must be between -180 and 180."),
    accuracy: z.number().finite("GPS accuracy must be a finite number.").min(0).max(200, "GPS accuracy must be within 200 meters.").optional()
  });

  const preferencesSchema = z.object({
    businessHours: z.record(z.string(), z.unknown()).refine((value) => Object.keys(value).length > 0, {
      message: t("validation.openDaysRequired")
    })
  });

  return {
    BUSINESS: businessSchema,
    BRANDING: brandingSchema,
    LEGAL: legalSchema,
    LOCATION: locationSchema,
    PREFERENCES: preferencesSchema,
    REVIEW: z.object({})
  };
}

export function validateStepPayload(
  step: OnboardingStep,
  payload: OnboardingPayload,
  rules: OnboardingRules,
  t: TranslationFn = defaultT
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const stepSchemas = createStepSchemas(t);
  const parsed = stepSchemas[step].safeParse(payload);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      issues.push({
        path: String(issue.path[0] ?? "form"),
        message: issue.message
      });
    }
  }

  for (const rule of rules.required[step] ?? []) {
    if (!rule.required) {
      continue;
    }
    const value = payload[rule.field];
    if (value === undefined || value === null || value === "" || isEmptyObject(value)) {
      issues.push({ path: rule.field, message: t("validation.required", { field: rule.label }) });
    }
    if (rule.pattern && typeof value === "string" && !new RegExp(rule.pattern).test(value)) {
      issues.push({ path: rule.field, message: `${rule.label} is not valid.` });
    }
  }

  return dedupeIssues(issues);
}

function isEmptyObject(value: unknown) {
  return typeof value === "object" && !Array.isArray(value) && value !== null && Object.keys(value).length === 0;
}

function dedupeIssues(issues: ValidationIssue[]) {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.path}:${issue.message}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
