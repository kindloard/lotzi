CREATE TYPE "OnboardingLifecycleState" AS ENUM (
  'PENDING',
  'BUSINESS_DONE',
  'BRANDING_DONE',
  'LEGAL_DONE',
  'PREFS_DONE',
  'READY_FOR_REVIEW',
  'LAUNCHED',
  'APPROVAL_PENDING',
  'ACTIVE',
  'SUSPENDED'
);

CREATE TYPE "OnboardingStep" AS ENUM (
  'BUSINESS',
  'BRANDING',
  'LEGAL',
  'PREFERENCES',
  'REVIEW'
);

CREATE TYPE "OnboardingValidationStatus" AS ENUM (
  'DRAFT',
  'VALID',
  'INVALID'
);

CREATE TYPE "StoreMediaKind" AS ENUM (
  'LOGO',
  'BANNER'
);

CREATE TYPE "StoreMediaProvider" AS ENUM (
  'CLOUDINARY'
);

CREATE TYPE "StoreMediaStatus" AS ENUM (
  'TEMP',
  'VALIDATED',
  'ATTACHED',
  'ORPHANED',
  'REJECTED'
);

CREATE TYPE "StoreApprovalStatus" AS ENUM (
  'PENDING',
  'AUTO_APPROVED',
  'MANUAL_REVIEW',
  'REJECTED'
);

CREATE TYPE "DomainEventStatus" AS ENUM (
  'PENDING',
  'PUBLISHED',
  'FAILED'
);

CREATE TABLE "store_business_profiles" (
  "store_id" UUID NOT NULL,
  "business_name" TEXT NOT NULL,
  "category" TEXT,
  "business_type" TEXT,
  "country" VARCHAR(2) NOT NULL DEFAULT 'IN',
  "legal_name" TEXT,
  "tax_id" VARCHAR(64),
  "gstin" VARCHAR(15),
  "registration_number" TEXT,
  "address_line" TEXT,
  "city" TEXT,
  "state" TEXT,
  "pincode" TEXT,
  "contact_email" CITEXT,
  "phone" TEXT,
  "verification_status" TEXT NOT NULL DEFAULT 'NOT_SUBMITTED',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "store_business_profiles_pkey" PRIMARY KEY ("store_id"),
  CONSTRAINT "store_business_profiles_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "store_media" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "store_id" UUID NOT NULL,
  "kind" "StoreMediaKind" NOT NULL,
  "provider" "StoreMediaProvider" NOT NULL DEFAULT 'CLOUDINARY',
  "provider_public_id" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "mime_type" TEXT NOT NULL,
  "byte_size" INTEGER NOT NULL,
  "width" INTEGER,
  "height" INTEGER,
  "checksum" TEXT,
  "status" "StoreMediaStatus" NOT NULL DEFAULT 'TEMP',
  "uploaded_by_user_id" UUID NOT NULL,
  "attached_at" TIMESTAMPTZ(3),
  "expires_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "store_media_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "store_media_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "store_media_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "store_branding" (
  "store_id" UUID NOT NULL,
  "logo_media_id" UUID,
  "banner_media_id" UUID,
  "tagline" TEXT,
  "description" TEXT,
  "primary_color" VARCHAR(16),
  "accent_color" VARCHAR(16),
  "theme_preset" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "store_branding_pkey" PRIMARY KEY ("store_id"),
  CONSTRAINT "store_branding_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "store_branding_logo_media_id_fkey" FOREIGN KEY ("logo_media_id") REFERENCES "store_media"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "store_branding_banner_media_id_fkey" FOREIGN KEY ("banner_media_id") REFERENCES "store_media"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "store_settings" (
  "store_id" UUID NOT NULL,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'INR',
  "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  "shipping_preference" TEXT,
  "notification_preferences" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "business_hours" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "store_settings_pkey" PRIMARY KEY ("store_id"),
  CONSTRAINT "store_settings_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "store_onboarding_states" (
  "store_id" UUID NOT NULL,
  "state" "OnboardingLifecycleState" NOT NULL DEFAULT 'PENDING',
  "current_step" "OnboardingStep" NOT NULL DEFAULT 'BUSINESS',
  "completion_percent" INTEGER NOT NULL DEFAULT 0,
  "business_completed_at" TIMESTAMPTZ(3),
  "branding_completed_at" TIMESTAMPTZ(3),
  "legal_completed_at" TIMESTAMPTZ(3),
  "preferences_completed_at" TIMESTAMPTZ(3),
  "review_ready_at" TIMESTAMPTZ(3),
  "launched_at" TIMESTAMPTZ(3),
  "approval_submitted_at" TIMESTAMPTZ(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "store_onboarding_states_pkey" PRIMARY KEY ("store_id"),
  CONSTRAINT "store_onboarding_states_completion_percent_check" CHECK ("completion_percent" >= 0 AND "completion_percent" <= 100),
  CONSTRAINT "store_onboarding_states_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "store_onboarding_drafts" (
  "store_id" UUID NOT NULL,
  "step" "OnboardingStep" NOT NULL,
  "step_payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "validation_status" "OnboardingValidationStatus" NOT NULL DEFAULT 'DRAFT',
  "validation_errors" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "version" INTEGER NOT NULL DEFAULT 1,
  "expires_at" TIMESTAMPTZ(3) NOT NULL DEFAULT (now() + '30 days'::interval),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "store_onboarding_drafts_pkey" PRIMARY KEY ("store_id", "step"),
  CONSTRAINT "store_onboarding_drafts_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "store_approval_reviews" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "store_id" UUID NOT NULL,
  "status" "StoreApprovalStatus" NOT NULL DEFAULT 'PENDING',
  "risk_score" INTEGER NOT NULL DEFAULT 0,
  "reason_codes" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "reviewed_by_user_id" UUID,
  "reviewed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "store_approval_reviews_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "store_approval_reviews_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "store_approval_reviews_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "domain_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "event_type" TEXT NOT NULL,
  "aggregate_type" TEXT NOT NULL,
  "aggregate_id" UUID NOT NULL,
  "payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "status" "DomainEventStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "next_run_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_error" TEXT,
  "published_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "domain_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "store_business_profiles_country_type_idx" ON "store_business_profiles"("country", "business_type");
CREATE INDEX "store_business_profiles_verification_idx" ON "store_business_profiles"("verification_status");

CREATE UNIQUE INDEX "store_media_store_provider_public_idx" ON "store_media"("store_id", "provider", "provider_public_id");
CREATE INDEX "store_media_store_kind_status_idx" ON "store_media"("store_id", "kind", "status");
CREATE INDEX "store_media_status_expires_idx" ON "store_media"("status", "expires_at");

CREATE INDEX "store_settings_currency_idx" ON "store_settings"("currency");

CREATE INDEX "store_onboarding_states_state_updated_idx" ON "store_onboarding_states"("state", "updated_at");
CREATE INDEX "store_onboarding_drafts_expires_idx" ON "store_onboarding_drafts"("expires_at");

CREATE INDEX "store_approval_reviews_store_status_idx" ON "store_approval_reviews"("store_id", "status");
CREATE INDEX "store_approval_reviews_status_created_idx" ON "store_approval_reviews"("status", "created_at");
CREATE UNIQUE INDEX "store_approval_reviews_store_id_key" ON "store_approval_reviews"("store_id");

CREATE INDEX "domain_events_status_next_run_idx" ON "domain_events"("status", "next_run_at");
CREATE INDEX "domain_events_aggregate_created_idx" ON "domain_events"("aggregate_type", "aggregate_id", "created_at");

INSERT INTO "store_onboarding_states" ("store_id", "state", "current_step", "completion_percent")
SELECT "id", 'PENDING', 'BUSINESS', 0
FROM "stores"
WHERE "deleted_at" IS NULL
ON CONFLICT ("store_id") DO NOTHING;
