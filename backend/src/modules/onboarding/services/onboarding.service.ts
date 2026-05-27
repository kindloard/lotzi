import { BadRequestException, Injectable } from "@nestjs/common";
import {
  OnboardingLifecycleState,
  OnboardingStep,
  Prisma,
  StoreOnboardingState,
  StoreStatus
} from "@prisma/client";
import { PrismaService } from "../../../database/prisma.service";
import { AuthenticatedPrincipal } from "../../auth/auth.types";
import { AuthStateInvalidator } from "../../rbac/auth-state-invalidator.service";
import { CompleteStepDto, DraftPayloadDto, LaunchOnboardingDto } from "../dto/onboarding.dto";
import { JsonRecord, OnboardingBootstrap, OnboardingStepCompletion, ValidationIssue } from "../onboarding.types";
import { ApprovalService } from "./approval.service";
import { DomainEventService } from "./domain-event.service";
import { DraftService } from "./draft.service";
import { MerchantOnboardingStoreService } from "./merchant-onboarding-store.service";
import { OnboardingStateMachine } from "./onboarding-state-machine.service";
import { ValidationRuleEngine } from "./validation-rule-engine.service";

const COORDINATE_SCALE = 1e7;

interface OnboardingAggregate {
  id: string;
  name: string;
  slug: string;
  status: StoreStatus;
  phone: string | null;
  email: string | null;
  legalName: string | null;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  latitude: unknown;
  longitude: unknown;
  businessProfile: {
    businessName: string;
    category: string | null;
    businessType: string | null;
    country: string;
    legalName: string | null;
    taxId: string | null;
    gstin: string | null;
    registrationNumber: string | null;
    addressLine: string | null;
    city: string | null;
    state: string | null;
    pincode: string | null;
    contactEmail: string | null;
    phone: string | null;
  } | null;
  branding: {
    logoMediaId: string | null;
    bannerMediaId: string | null;
    tagline: string | null;
    description: string | null;
    primaryColor: string | null;
    accentColor: string | null;
    logoMedia: { url: string } | null;
    bannerMedia: { url: string } | null;
  } | null;
  settings: { businessHours: Prisma.JsonValue } | null;
  onboardingState: StoreOnboardingState | null;
  onboardingDrafts: Array<{
    step: OnboardingStep;
    stepPayload: Prisma.JsonValue;
    version: number;
    validationErrors: Prisma.JsonValue;
  }>;
}

interface RawOnboardingAggregateRow {
  id: string;
  name: string;
  slug: string;
  status: StoreStatus;
  phone: string | null;
  email: string | null;
  legal_name: string | null;
  address_line: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  latitude: unknown;
  longitude: unknown;
  business_profile: OnboardingAggregate["businessProfile"];
  branding: OnboardingAggregate["branding"];
  settings: OnboardingAggregate["settings"];
  onboarding_state: StoreOnboardingState | null;
  onboarding_drafts: OnboardingAggregate["onboardingDrafts"] | null;
}

@Injectable()
export class OnboardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stores: MerchantOnboardingStoreService,
    private readonly drafts: DraftService,
    private readonly events: DomainEventService,
    private readonly rules: ValidationRuleEngine,
    private readonly stateMachine: OnboardingStateMachine,
    private readonly approval: ApprovalService,
    private readonly authStateInvalidator: AuthStateInvalidator
  ) {}

  async bootstrap(auth: AuthenticatedPrincipal): Promise<OnboardingBootstrap> {
    const store = await this.stores.requireCurrentStore(auth);
    const stateResult = await this.stores.ensureState(store.id);
    if (stateResult.created) {
      await this.events.enqueue({
        eventType: "merchant.onboarding.started",
        aggregateType: "store",
        aggregateId: store.id,
        payload: { userId: auth.userId, source: "bootstrap" }
      });
    }

    const aggregate = await this.loadAggregate(store.id);
    return this.toBootstrap(aggregate);
  }

  async saveDraft(
    auth: AuthenticatedPrincipal,
    step: OnboardingStep,
    dto: DraftPayloadDto
  ) {
    const store = await this.stores.requireCurrentStore(auth);
    const payload = draftPayloadForStep(step, dto.payload);
    const draft = await this.drafts.save({
      storeId: store.id,
      step,
      payload,
      expectedVersion: dto.version
    });

    return {
      step: draft.step,
      payload: toRecord(draft.stepPayload),
      version: draft.version,
      validationErrors: issuesFromJson(draft.validationErrors)
    };
  }

  async completeStep(
    auth: AuthenticatedPrincipal,
    step: OnboardingStep,
    dto: CompleteStepDto
  ): Promise<OnboardingStepCompletion> {
    const store = await this.stores.requireCurrentStore(auth);
    const aggregate = await this.loadAggregate(store.id);
    const businessContext = step === OnboardingStep.BUSINESS ? dto.payload : this.businessData(aggregate);
    const rules = this.rules.rulesFor({
      country: stringValue(businessContext.country),
      businessType: stringValue(businessContext.businessType)
    });
    const issues = this.rules.validateStep(step, dto.payload, rules);
    const expectedDraftVersion = step === OnboardingStep.LOCATION ? undefined : dto.version;

    if (issues.length) {
      await this.drafts.save({
        storeId: store.id,
        step,
        payload: draftPayloadForStep(step, dto.payload),
        expectedVersion: expectedDraftVersion,
        validationErrors: issues
      });
      throw new BadRequestException({
        message: "Onboarding step has validation errors.",
        errors: issues
      });
    }

    const completion = await this.prisma.$transaction(async (tx) => {
      const stateResult = await this.stores.ensureState(store.id, tx);
      const transition = this.stateMachine.completeStep(stateResult.state.state, step);
      const draft = await this.drafts.save(
        {
          storeId: store.id,
          step,
          payload: draftPayloadForStep(step, dto.payload),
          expectedVersion: expectedDraftVersion,
          validationErrors: []
        },
        tx
      );
      await this.commitStep(store.id, step, dto.payload, tx);
      const state = await this.advanceState(store.id, stateResult.state, transition, tx);
      await this.events.enqueue(
        {
          eventType: "merchant.onboarding.step_completed",
          aggregateType: "store",
          aggregateId: store.id,
          payload: { step, userId: auth.userId }
        },
        tx
      );
      return { draft, state };
    });
    void this.authStateInvalidator.invalidateUserVersions(auth.userId, [auth.authzVersion]);

    return {
      step,
      state: this.toState(completion.state),
      draft: {
        step: completion.draft.step,
        version: completion.draft.version,
        validationErrors: issuesFromJson(completion.draft.validationErrors)
      },
      ...(step === OnboardingStep.BUSINESS ? { rules } : {})
    };
  }

  async launch(auth: AuthenticatedPrincipal, dto: LaunchOnboardingDto) {
    const store = await this.stores.requireCurrentStore(auth);
    const aggregate = await this.loadAggregate(store.id);
    const state = aggregate.onboardingState ?? (await this.stores.ensureState(store.id)).state;

    const launchMode = this.stateMachine.assertCanLaunch(state.state);
    if (launchMode === "already-launched") {
      return {
        status: state.state === OnboardingLifecycleState.ACTIVE ? "ACTIVE" : "APPROVAL_PENDING",
        redirectTo: "/merchant/dashboard",
        storeId: store.id,
        state: state.state
      };
    }

    const data = {
      business: this.businessData(aggregate),
      branding: this.brandingData(aggregate),
      legal: this.legalData(aggregate),
      location: this.locationData(aggregate),
      preferences: this.preferencesData(aggregate)
    };
    const issues = this.rules.validateLaunch(data);
    if (issues.length) {
      throw new BadRequestException({
        message: "Onboarding is incomplete.",
        errors: issues
      });
    }

    await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      await tx.storeOnboardingState.update({
        where: { storeId: store.id },
        data: {
          state: OnboardingLifecycleState.APPROVAL_PENDING,
          currentStep: OnboardingStep.REVIEW,
          completionPercent: 100,
          reviewReadyAt: state.reviewReadyAt ?? now,
          launchedAt: now,
          approvalSubmittedAt: now,
          version: { increment: 1 }
        }
      });
      await tx.store.update({
        where: { id: store.id },
        data: { status: StoreStatus.PENDING }
      });
      await this.approval.ensurePendingReview(store.id, tx);
      await this.events.enqueue(
        {
          eventType: "merchant.profile.submitted_for_review",
          aggregateType: "store",
          aggregateId: store.id,
          payload: { userId: auth.userId, idempotencyKey: dto.idempotencyKey ?? null }
        },
        tx
      );
      await this.events.enqueue(
        {
          eventType: "merchant.approval.pending",
          aggregateType: "store",
          aggregateId: store.id,
          payload: { userId: auth.userId, riskScore: 20 }
        },
        tx
      );
    });
    void this.authStateInvalidator.invalidateUserVersions(auth.userId, [auth.authzVersion]);

    return {
      status: "APPROVAL_PENDING",
      redirectTo: "/merchant/dashboard",
      storeId: store.id,
      state: OnboardingLifecycleState.APPROVAL_PENDING
    };
  }

  private async loadAggregate(storeId: string) {
    const rows = await this.prisma.$queryRaw<RawOnboardingAggregateRow[]>`
      SELECT
        s.id,
        s.name,
        s.slug,
        s.status,
        s.phone,
        s.email,
        s.legal_name,
        s.address_line,
        s.city,
        s.state,
        s.pincode,
        s.latitude,
        s.longitude,
        CASE
          WHEN bp.store_id IS NULL THEN NULL
          ELSE jsonb_build_object(
            'businessName', bp.business_name,
            'category', bp.category,
            'businessType', bp.business_type,
            'country', bp.country,
            'legalName', bp.legal_name,
            'taxId', bp.tax_id,
            'gstin', bp.gstin,
            'registrationNumber', bp.registration_number,
            'addressLine', bp.address_line,
            'city', bp.city,
            'state', bp.state,
            'pincode', bp.pincode,
            'contactEmail', bp.contact_email,
            'phone', bp.phone
          )
        END AS business_profile,
        CASE
          WHEN branding.store_id IS NULL THEN NULL
          ELSE jsonb_build_object(
            'logoMediaId', branding.logo_media_id,
            'bannerMediaId', branding.banner_media_id,
            'tagline', branding.tagline,
            'description', branding.description,
            'primaryColor', branding.primary_color,
            'accentColor', branding.accent_color,
            'logoMedia', CASE
              WHEN logo.id IS NULL THEN NULL
              ELSE jsonb_build_object('url', logo.url)
            END,
            'bannerMedia', CASE
              WHEN banner.id IS NULL THEN NULL
              ELSE jsonb_build_object('url', banner.url)
            END
          )
        END AS branding,
        CASE
          WHEN settings.store_id IS NULL THEN NULL
          ELSE jsonb_build_object('businessHours', settings.business_hours)
        END AS settings,
        CASE
          WHEN os.store_id IS NULL THEN NULL
          ELSE jsonb_build_object(
            'storeId', os.store_id,
            'state', os.state,
            'currentStep', os.current_step,
            'completionPercent', os.completion_percent,
            'businessCompletedAt', os.business_completed_at,
            'brandingCompletedAt', os.branding_completed_at,
            'legalCompletedAt', os.legal_completed_at,
            'locationCompletedAt', os.location_completed_at,
            'preferencesCompletedAt', os.preferences_completed_at,
            'reviewReadyAt', os.review_ready_at,
            'launchedAt', os.launched_at,
            'approvalSubmittedAt', os.approval_submitted_at,
            'version', os.version,
            'createdAt', os.created_at,
            'updatedAt', os.updated_at
          )
        END AS onboarding_state,
        COALESCE(
          (
            SELECT jsonb_agg(
              jsonb_build_object(
                'step', d.step,
                'stepPayload', d.step_payload,
                'version', d.version,
                'validationErrors', d.validation_errors
              )
              ORDER BY d.updated_at DESC
            )
            FROM store_onboarding_drafts d
            WHERE d.store_id = s.id
          ),
          '[]'::jsonb
        ) AS onboarding_drafts
      FROM stores s
      LEFT JOIN store_business_profiles bp ON bp.store_id = s.id
      LEFT JOIN store_branding branding ON branding.store_id = s.id
      LEFT JOIN store_media logo ON logo.id = branding.logo_media_id
      LEFT JOIN store_media banner ON banner.id = branding.banner_media_id
      LEFT JOIN store_settings settings ON settings.store_id = s.id
      LEFT JOIN store_onboarding_states os ON os.store_id = s.id
      WHERE s.id = ${storeId}::uuid
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) {
      throw new Error("Store not found.");
    }
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      status: row.status,
      phone: row.phone,
      email: row.email,
      legalName: row.legal_name,
      addressLine: row.address_line,
      city: row.city,
      state: row.state,
      pincode: row.pincode,
      latitude: row.latitude,
      longitude: row.longitude,
      businessProfile: row.business_profile,
      branding: row.branding,
      settings: row.settings,
      onboardingState: coerceOnboardingState(row.onboarding_state),
      onboardingDrafts: row.onboarding_drafts ?? []
    } satisfies OnboardingAggregate;
  }

  private async commitStep(
    storeId: string,
    step: OnboardingStep,
    payload: JsonRecord,
    tx: Prisma.TransactionClient
  ) {
    if (step === OnboardingStep.BUSINESS) {
      const storeName = requiredString(payload.storeName);
      await tx.store.update({
        where: { id: storeId },
        data: {
          name: storeName,
          phone: stringValue(payload.phone)
        }
      });
      await tx.storeBusinessProfile.upsert({
        where: { storeId },
        create: {
          storeId,
          businessName: storeName,
          category: stringValue(payload.category),
          businessType: stringValue(payload.businessType),
          country: stringValue(payload.country) ?? "IN",
          phone: stringValue(payload.phone)
        },
        update: {
          businessName: storeName,
          category: stringValue(payload.category),
          businessType: stringValue(payload.businessType),
          country: stringValue(payload.country) ?? "IN",
          phone: stringValue(payload.phone)
        }
      });
      return;
    }

    if (step === OnboardingStep.BRANDING) {
      await tx.storeBranding.upsert({
        where: { storeId },
        create: {
          storeId,
          tagline: stringValue(payload.tagline),
          description: stringValue(payload.description),
          primaryColor: stringValue(payload.primaryColor),
          accentColor: stringValue(payload.accentColor)
        },
        update: {
          tagline: stringValue(payload.tagline),
          description: stringValue(payload.description),
          primaryColor: stringValue(payload.primaryColor),
          accentColor: stringValue(payload.accentColor)
        }
      });
      return;
    }

    if (step === OnboardingStep.LEGAL) {
      await tx.store.update({
        where: { id: storeId },
        data: {
          legalName: stringValue(payload.legalName),
          email: stringValue(payload.contactEmail),
          addressLine: stringValue(payload.addressLine),
          city: stringValue(payload.city),
          state: stringValue(payload.state),
          pincode: stringValue(payload.pincode)
        }
      });
      await tx.storeBusinessProfile.upsert({
        where: { storeId },
        create: {
          storeId,
          businessName: stringValue(payload.legalName) ?? "Merchant store",
          legalName: stringValue(payload.legalName),
          taxId: stringValue(payload.taxId),
          gstin: stringValue(payload.gstin),
          registrationNumber: stringValue(payload.registrationNumber),
          addressLine: stringValue(payload.addressLine),
          city: stringValue(payload.city),
          state: stringValue(payload.state),
          pincode: stringValue(payload.pincode),
          contactEmail: stringValue(payload.contactEmail)
        },
        update: {
          legalName: stringValue(payload.legalName),
          taxId: stringValue(payload.taxId),
          gstin: stringValue(payload.gstin),
          registrationNumber: stringValue(payload.registrationNumber),
          addressLine: stringValue(payload.addressLine),
          city: stringValue(payload.city),
          state: stringValue(payload.state),
          pincode: stringValue(payload.pincode),
          contactEmail: stringValue(payload.contactEmail)
        }
      });
      return;
    }

    if (step === OnboardingStep.LOCATION) {
      await tx.store.update({
        where: { id: storeId },
        data: {
          latitude: roundedCoordinate(payload.latitude, "Latitude", -90, 90),
          longitude: roundedCoordinate(payload.longitude, "Longitude", -180, 180)
        }
      });
      return;
    }

    if (step === OnboardingStep.PREFERENCES) {
      await tx.storeSettings.upsert({
        where: { storeId },
        create: {
          storeId,
          businessHours: businessHoursValue(payload.businessHours)
        },
        update: {
          businessHours: businessHoursValue(payload.businessHours)
        }
      });
    }
  }

  private async advanceState(
    storeId: string,
    current: StoreOnboardingState,
    transition: ReturnType<OnboardingStateMachine["completeStep"]>,
    tx: Prisma.TransactionClient
  ) {
    const completedAt = timestampPatch(transition.completedAtField, new Date());
    return tx.storeOnboardingState.update({
      where: { storeId },
      data: {
        state: transition.state,
        currentStep: transition.currentStep ?? current.currentStep,
        completionPercent: transition.completionPercent ?? current.completionPercent,
        version: { increment: 1 },
        ...completedAt
      }
    });
  }

  private toState(state: StoreOnboardingState): OnboardingBootstrap["state"] {
    return {
      lifecycle: state.state,
      currentStep: state.currentStep,
      completionPercent: state.completionPercent,
      version: state.version
    };
  }

  private toBootstrap(aggregate: OnboardingAggregate): OnboardingBootstrap {
    const state = aggregate.onboardingState;
    const business = this.businessData(aggregate);
    const drafts = Object.fromEntries(
      aggregate.onboardingDrafts.map((draft) => [
        draft.step,
        {
          payload: toRecord(draft.stepPayload),
          version: draft.version,
          validationErrors: issuesFromJson(draft.validationErrors)
        }
      ])
    ) as OnboardingBootstrap["drafts"];

    return {
      store: {
        id: aggregate.id,
        name: aggregate.name,
        slug: aggregate.slug,
        status: aggregate.status
      },
      state: {
        lifecycle: state?.state ?? OnboardingLifecycleState.PENDING,
        currentStep: state?.currentStep ?? OnboardingStep.BUSINESS,
        completionPercent: state?.completionPercent ?? 0,
        version: state?.version ?? 1
      },
      data: {
        business,
        branding: this.brandingData(aggregate),
        legal: this.legalData(aggregate),
        location: this.locationData(aggregate),
        preferences: this.preferencesData(aggregate)
      },
      drafts,
      rules: this.rules.rulesFor({
        country: stringValue(business.country),
        businessType: stringValue(business.businessType)
      })
    };
  }

  private businessData(aggregate: OnboardingAggregate): JsonRecord {
    return {
      storeName: aggregate.businessProfile?.businessName ?? aggregate.name,
      category: aggregate.businessProfile?.category ?? "",
      businessType: aggregate.businessProfile?.businessType ?? "",
      country: aggregate.businessProfile?.country ?? "IN",
      phone: aggregate.businessProfile?.phone ?? aggregate.phone ?? ""
    };
  }

  private brandingData(aggregate: OnboardingAggregate): JsonRecord {
    return {
      logoMediaId: aggregate.branding?.logoMediaId ?? "",
      logoUrl: aggregate.branding?.logoMedia?.url ?? "",
      bannerMediaId: aggregate.branding?.bannerMediaId ?? "",
      bannerUrl: aggregate.branding?.bannerMedia?.url ?? "",
      tagline: aggregate.branding?.tagline ?? "",
      description: aggregate.branding?.description ?? "",
      primaryColor: aggregate.branding?.primaryColor ?? "#0f766e",
      accentColor: aggregate.branding?.accentColor ?? "#f59e0b"
    };
  }

  private legalData(aggregate: OnboardingAggregate): JsonRecord {
    return {
      legalName: aggregate.businessProfile?.legalName ?? aggregate.legalName ?? "",
      taxId: aggregate.businessProfile?.taxId ?? "",
      gstin: aggregate.businessProfile?.gstin ?? "",
      registrationNumber: aggregate.businessProfile?.registrationNumber ?? "",
      addressLine: aggregate.businessProfile?.addressLine ?? aggregate.addressLine ?? "",
      city: aggregate.businessProfile?.city ?? aggregate.city ?? "",
      state: aggregate.businessProfile?.state ?? aggregate.state ?? "",
      pincode: aggregate.businessProfile?.pincode ?? aggregate.pincode ?? "",
      contactEmail: aggregate.businessProfile?.contactEmail ?? aggregate.email ?? ""
    };
  }

  private locationData(aggregate: OnboardingAggregate): JsonRecord {
    const latitude = decimalToRoundedNumber(aggregate.latitude);
    const longitude = decimalToRoundedNumber(aggregate.longitude);

    return {
      ...(latitude === undefined ? {} : { latitude }),
      ...(longitude === undefined ? {} : { longitude })
    };
  }

  private preferencesData(aggregate: OnboardingAggregate): JsonRecord {
    return {
      businessHours: normalizeBusinessHours(toRecord(aggregate.settings?.businessHours))
    };
  }
}

function timestampPatch(
  field:
    | "businessCompletedAt"
    | "brandingCompletedAt"
    | "legalCompletedAt"
    | "locationCompletedAt"
    | "preferencesCompletedAt"
    | "reviewReadyAt",
  value: Date
): Prisma.StoreOnboardingStateUpdateInput {
  return { [field]: value } as Prisma.StoreOnboardingStateUpdateInput;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function requiredString(value: unknown): string {
  const text = stringValue(value);
  if (!text) {
    throw new BadRequestException("Missing required text field.");
  }
  return text;
}

function roundedCoordinate(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new BadRequestException(`${label} must be a finite number.`);
  }
  if (value < min || value > max) {
    throw new BadRequestException(`${label} is out of range.`);
  }
  return roundCoordinate(value);
}

function decimalToRoundedNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? roundCoordinate(value) : undefined;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? roundCoordinate(parsed) : undefined;
  }

  if (typeof value === "object" && "toNumber" in value && typeof value.toNumber === "function") {
    const parsed = value.toNumber();
    return Number.isFinite(parsed) ? roundCoordinate(parsed) : undefined;
  }

  return undefined;
}

function roundCoordinate(value: number): number {
  return Math.round(value * COORDINATE_SCALE) / COORDINATE_SCALE;
}

function draftPayloadForStep(step: OnboardingStep, payload: JsonRecord): JsonRecord {
  if (step === OnboardingStep.PREFERENCES) {
    return {
      ...payload,
      businessHours: normalizeBusinessHours(toRecord(payload.businessHours))
    };
  }

  if (step !== OnboardingStep.LOCATION) {
    return payload;
  }

  const latitude = typeof payload.latitude === "number" && Number.isFinite(payload.latitude)
    ? roundCoordinate(payload.latitude)
    : undefined;
  const longitude = typeof payload.longitude === "number" && Number.isFinite(payload.longitude)
    ? roundCoordinate(payload.longitude)
    : undefined;

  return {
    ...(latitude === undefined ? {} : { latitude }),
    ...(longitude === undefined ? {} : { longitude })
  };
}

function businessHoursValue(value: unknown): Prisma.InputJsonValue {
  return normalizeBusinessHours(toRecord(value)) as Prisma.InputJsonObject;
}

function normalizeBusinessHours(value: JsonRecord): JsonRecord {
  return Object.fromEntries(
    Object.entries(value).map(([day, hours]) => [day, normalizeBusinessHourText(hours)])
  );
}

function normalizeBusinessHourText(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();
  const range = trimmed.match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
  if (!range) {
    return trimmed;
  }

  return `${toTwelveHour(Number(range[1]), range[2])} - ${toTwelveHour(Number(range[3]), range[4])}`;
}

function toTwelveHour(hour: number, minute: string): string {
  const period = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minute} ${period}`;
}

function toRecord(value: unknown): JsonRecord {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as JsonRecord;
  }
  return {};
}

function issuesFromJson(value: unknown): ValidationIssue[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (item): item is ValidationIssue =>
      Boolean(item) &&
      typeof item === "object" &&
      typeof (item as ValidationIssue).path === "string" &&
      typeof (item as ValidationIssue).message === "string"
  );
}

function coerceOnboardingState(value: StoreOnboardingState | null): StoreOnboardingState | null {
  if (!value) {
    return null;
  }
  return {
    ...value,
    businessCompletedAt: nullableDate(value.businessCompletedAt),
    brandingCompletedAt: nullableDate(value.brandingCompletedAt),
    legalCompletedAt: nullableDate(value.legalCompletedAt),
    locationCompletedAt: nullableDate(value.locationCompletedAt),
    preferencesCompletedAt: nullableDate(value.preferencesCompletedAt),
    reviewReadyAt: nullableDate(value.reviewReadyAt),
    launchedAt: nullableDate(value.launchedAt),
    approvalSubmittedAt: nullableDate(value.approvalSubmittedAt),
    createdAt: nullableDate(value.createdAt) ?? new Date(),
    updatedAt: nullableDate(value.updatedAt) ?? new Date()
  };
}

function nullableDate(value: unknown): Date | null {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return value;
  }
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}
