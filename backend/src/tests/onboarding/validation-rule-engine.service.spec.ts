import { OnboardingStep } from "@prisma/client";
import { ValidationRuleEngine } from "../../modules/onboarding/services/validation-rule-engine.service";

describe("ValidationRuleEngine", () => {
  const engine = new ValidationRuleEngine();

  it("requires GSTIN for Indian registered businesses", () => {
    const rules = engine.rulesFor({ country: "IN", businessType: "private_limited" });
    const issues = engine.validateStep(
      OnboardingStep.LEGAL,
      {
        legalName: "Nama Retail Pvt Ltd",
        addressLine: "MG Road",
        city: "Bengaluru",
        state: "Karnataka",
        pincode: "560001",
        contactEmail: "ops@example.com"
      },
      rules
    );

    expect(issues).toContainEqual({ path: "gstin", message: "GSTIN is required." });
  });

  it("uses registration number instead of GSTIN for non-India companies", () => {
    const rules = engine.rulesFor({ country: "US", businessType: "enterprise" });
    const required = rules.required.LEGAL.map((rule) => rule.field);

    expect(required).toContain("registrationNumber");
    expect(required).not.toContain("gstin");
  });

  it("validates launch data across business, legal, and preference steps", () => {
    const issues = engine.validateLaunch({
      business: {
        storeName: "Fresh Mart",
        category: "grocery",
        businessType: "sole_proprietor",
        country: "IN",
        phone: "9876543210"
      },
      branding: {},
      legal: {
        legalName: "Fresh Mart",
        addressLine: "MG Road",
        city: "Bengaluru",
        state: "Karnataka",
        pincode: "560001",
        contactEmail: "owner@example.com"
      },
      location: {
        latitude: 12.9715987,
        longitude: 77.594566
      },
      preferences: {
        businessHours: { monday: "9:00 AM - 6:00 PM" }
      }
    });

    expect(issues).toEqual([]);
  });

  it("only requires business hours for preferences", () => {
    const rules = engine.rulesFor({ country: "IN", businessType: "sole_proprietor" });
    const required = rules.required.PREFERENCES.map((rule) => rule.field);

    expect(required).toEqual(["businessHours"]);
    expect(engine.validateStep(OnboardingStep.PREFERENCES, { businessHours: { monday: "9:00 AM - 6:00 PM" } }, rules)).toEqual([]);
  });

  it("requires finite in-range GPS coordinates for the location step", () => {
    const rules = engine.rulesFor({ country: "IN", businessType: "unregistered" });

    expect(engine.validateStep(OnboardingStep.LOCATION, {}, rules)).toEqual([
      { path: "latitude", message: "Latitude is required." },
      { path: "longitude", message: "Longitude is required." }
    ]);

    expect(
      engine.validateStep(
        OnboardingStep.LOCATION,
        { latitude: 91, longitude: 181 },
        rules
      )
    ).toEqual([
      { path: "latitude", message: "Latitude must be between -90 and 90." },
      { path: "longitude", message: "Longitude must be between -180 and 180." }
    ]);
  });

  it("rejects inaccurate or non-finite GPS captures", () => {
    const rules = engine.rulesFor({ country: "IN", businessType: "unregistered" });

    expect(
      engine.validateStep(
        OnboardingStep.LOCATION,
        { latitude: Number.NaN, longitude: 77.594566, accuracy: 50 },
        rules
      )
    ).toContainEqual({ path: "latitude", message: "Latitude must be a finite number." });

    expect(
      engine.validateStep(
        OnboardingStep.LOCATION,
        { latitude: 12.9715987, longitude: 77.594566, accuracy: 5000 },
        rules
      )
    ).toContainEqual({ path: "accuracy", message: "GPS accuracy must be within 200 meters." });
  });
});
