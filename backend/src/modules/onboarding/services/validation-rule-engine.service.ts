import { Injectable } from "@nestjs/common";
import { OnboardingStep } from "@prisma/client";
import { FieldRule, JsonRecord, OnboardingRules, ValidationIssue } from "../onboarding.types";

const GPS_ACCURACY_THRESHOLD_METERS = 200;

const baseOptions = {
  businessTypes: [
    { value: "sole_proprietor", label: "Sole proprietor" },
    { value: "partnership", label: "Partnership" },
    { value: "llp", label: "LLP" },
    { value: "private_limited", label: "Private limited" },
    { value: "enterprise", label: "Enterprise" }
  ],
  categories: [
    { value: "grocery", label: "Grocery & essentials" },
    { value: "fashion", label: "Fashion & apparel" },
    { value: "vegetables", label: "Vegetables & Fruits" },
    { value: "beauty", label: "Beauty & wellness" },
    { value: "home", label: "Home & living" },
    { value: "food", label: "Food & beverage" }
  ],
  countries: [
    { value: "IN", label: "India" },
    { value: "US", label: "United States" },
    { value: "GB", label: "United Kingdom" },
    { value: "AE", label: "United Arab Emirates" }
  ]
};

@Injectable()
export class ValidationRuleEngine {
  rulesFor(input: { country?: string | null; businessType?: string | null }): OnboardingRules {
    const country = (input.country ?? "IN").toUpperCase();
    const businessType = input.businessType ?? undefined;
    const legalRequired = this.legalRules(country, businessType);

    return {
      country,
      businessType,
      required: {
        [OnboardingStep.BUSINESS]: [
          required("storeName", "Store name"),
          required("category", "Business category"),
          required("businessType", "Business type"),
          required("country", "Country"),
          required("phone", "Business phone")
        ],
        [OnboardingStep.BRANDING]: [],
        [OnboardingStep.LEGAL]: legalRequired,
        [OnboardingStep.LOCATION]: [
          required("latitude", "Latitude"),
          required("longitude", "Longitude")
        ],
        [OnboardingStep.PREFERENCES]: [
          required("businessHours", "Business hours")
        ],
        [OnboardingStep.REVIEW]: []
      },
      options: baseOptions
    };
  }

  validateStep(step: OnboardingStep, payload: JsonRecord, rules: OnboardingRules): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    for (const field of rules.required[step] ?? []) {
      if (!field.required) {
        continue;
      }
      if (isBlank(payload[field.field])) {
        issues.push({ path: field.field, message: `${field.label} is required.` });
        continue;
      }
      const value = payload[field.field];
      if (field.pattern && typeof value === "string") {
        const regex = new RegExp(field.pattern);
        if (!regex.test(value)) {
          issues.push({ path: field.field, message: `${field.label} is not valid.` });
        }
      }
    }

    if (step === OnboardingStep.BUSINESS && typeof payload.storeName === "string" && payload.storeName.trim().length < 2) {
      issues.push({ path: "storeName", message: "Store name must be at least 2 characters." });
    }

    if (step === OnboardingStep.BRANDING) {
      for (const colorField of ["primaryColor", "accentColor"]) {
        const value = payload[colorField];
        if (typeof value === "string" && value && !/^#[0-9a-f]{6}$/i.test(value)) {
          issues.push({ path: colorField, message: "Use a valid hex color." });
        }
      }
    }

    if (step === OnboardingStep.LOCATION) {
      const latitude = finiteNumber(payload.latitude);
      const longitude = finiteNumber(payload.longitude);
      const accuracy = payload.accuracy === undefined || payload.accuracy === null ? undefined : finiteNumber(payload.accuracy);

      if (latitude !== undefined && (latitude < -90 || latitude > 90)) {
        issues.push({ path: "latitude", message: "Latitude must be between -90 and 90." });
      }

      if (longitude !== undefined && (longitude < -180 || longitude > 180)) {
        issues.push({ path: "longitude", message: "Longitude must be between -180 and 180." });
      }

      if (payload.latitude !== undefined && latitude === undefined) {
        issues.push({ path: "latitude", message: "Latitude must be a finite number." });
      }

      if (payload.longitude !== undefined && longitude === undefined) {
        issues.push({ path: "longitude", message: "Longitude must be a finite number." });
      }

      if (payload.accuracy !== undefined && payload.accuracy !== null) {
        if (accuracy === undefined || accuracy < 0) {
          issues.push({ path: "accuracy", message: "GPS accuracy must be a finite positive number." });
        } else if (accuracy > GPS_ACCURACY_THRESHOLD_METERS) {
          issues.push({ path: "accuracy", message: `GPS accuracy must be within ${GPS_ACCURACY_THRESHOLD_METERS} meters.` });
        }
      }
    }

    return issues;
  }

  validateLaunch(data: {
    business: JsonRecord;
    branding: JsonRecord;
    legal: JsonRecord;
    location: JsonRecord;
    preferences: JsonRecord;
  }): ValidationIssue[] {
    const rules = this.rulesFor({
      country: stringValue(data.business.country),
      businessType: stringValue(data.business.businessType)
    });
    return [
      ...this.validateStep(OnboardingStep.BUSINESS, data.business, rules),
      ...this.validateStep(OnboardingStep.LEGAL, data.legal, rules),
      ...this.validateStep(OnboardingStep.LOCATION, data.location, rules),
      ...this.validateStep(OnboardingStep.PREFERENCES, data.preferences, rules)
    ];
  }

  private legalRules(country: string, businessType?: string): FieldRule[] {
    const registeredBusinessTypes = new Set(["partnership", "llp", "private_limited", "enterprise"]);
    const fields = [
      required("addressLine", "Business address"),
      required("city", "City"),
      required("state", "State"),
      required("pincode", "Postal code"),
      required("contactEmail", "Contact email")
    ];

    if (country === "IN" && businessType && registeredBusinessTypes.has(businessType)) {
      fields.push(required("gstin", "GSTIN"));
    }

    if (country !== "IN" && businessType && registeredBusinessTypes.has(businessType)) {
      fields.push(required("registrationNumber", "Registration number"));
    }

    return fields;
  }
}

function required(field: string, label: string, pattern?: string): FieldRule {
  return { field, label, required: true, pattern };
}

function isBlank(value: unknown) {
  if (value === null || value === undefined) {
    return true;
  }
  if (typeof value === "string") {
    return value.trim().length === 0;
  }
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  if (typeof value === "object") {
    return Object.keys(value).length === 0;
  }
  return false;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
