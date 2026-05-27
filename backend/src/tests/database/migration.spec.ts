import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("multi-tenant identity migration", () => {
  const migration = readFileSync(
    join(process.cwd(), "prisma/migrations/20260522103000_multi_tenant_identity/migration.sql"),
    "utf8"
  );

  it("backfills profiles, memberships, and roles before dropping legacy user role", () => {
    expect(migration).toContain('INSERT INTO "customer_profiles"');
    expect(migration).toContain('INSERT INTO "merchant_profiles"');
    expect(migration).toContain('INSERT INTO "store_members"');
    expect(migration.indexOf('WHERE u."role" = \'ADMIN\'')).toBeGreaterThan(-1);
    expect(migration.indexOf('ALTER TABLE "users" DROP COLUMN "role"')).toBeGreaterThan(
      migration.indexOf('WHERE u."role" = \'ADMIN\'')
    );
  });

  it("cleans orphan audit references before adding audit foreign keys", () => {
    expect(migration.indexOf("orphan_actor_user_id")).toBeGreaterThan(-1);
    expect(migration.indexOf("orphan_session_id")).toBeGreaterThan(-1);
    expect(migration.indexOf('"actor_user_id" = NULL')).toBeLessThan(
      migration.indexOf('ADD CONSTRAINT "audit_logs_actor_user_id_fkey"')
    );
    expect(migration.indexOf('"session_id" = NULL')).toBeLessThan(
      migration.indexOf('ADD CONSTRAINT "audit_logs_session_id_fkey"')
    );
  });
});

describe("auth performance migration", () => {
  const migration = readFileSync(
    join(process.cwd(), "prisma/migrations/20260522170000_auth_performance_indexes/migration.sql"),
    "utf8"
  );

  it("adds partial indexes for pending OTP and active-session hot paths", () => {
    expect(migration).toContain("otp_pending_email_purpose_created_idx");
    expect(migration).toContain("otp_pending_user_email_purpose_created_idx");
    expect(migration).toContain("sessions_active_user_seen_idx");
    expect(migration).toContain('WHERE "verified" = false');
    expect(migration).toContain('WHERE "revoked" = false');
  });

  it("adds a pending store lookup index for merchant onboarding", () => {
    expect(migration).toContain("stores_pending_creator_name_idx");
    expect(migration).toContain('"status" = \'PENDING\'');
    expect(migration).toContain('"deleted_at" IS NULL');
  });
});

describe("merchant onboarding architecture migration", () => {
  const migration = readFileSync(
    join(process.cwd(), "prisma/migrations/20260522190000_merchant_onboarding_architecture/migration.sql"),
    "utf8"
  );

  it("keeps onboarding data normalized outside the stores hot row", () => {
    expect(migration).toContain('CREATE TABLE "store_business_profiles"');
    expect(migration).toContain('CREATE TABLE "store_branding"');
    expect(migration).toContain('CREATE TABLE "store_settings"');
    expect(migration).toContain('CREATE TABLE "store_onboarding_states"');
    expect(migration).toContain('CREATE TABLE "store_onboarding_drafts"');
    expect(migration).toContain('CREATE TABLE "store_media"');
    expect(migration).toContain('CREATE TABLE "store_approval_reviews"');
    expect(migration).not.toContain('ALTER TABLE "stores" ADD COLUMN "onboarding_draft"');
  });

  it("adds lifecycle enums, event outbox, and queue indexes", () => {
    expect(migration).toContain('CREATE TYPE "OnboardingLifecycleState"');
    expect(migration).toContain('CREATE TYPE "DomainEventStatus"');
    expect(migration).toContain('CREATE TABLE "domain_events"');
    expect(migration).toContain("domain_events_status_next_run_idx");
    expect(migration).toContain("store_onboarding_states_state_updated_idx");
  });

  it("indexes write-heavy drafts and media cleanup paths", () => {
    expect(migration).toContain('PRIMARY KEY ("store_id", "step")');
    expect(migration).toContain("store_onboarding_drafts_expires_idx");
    expect(migration).toContain("store_media_store_kind_status_idx");
    expect(migration).toContain("store_media_status_expires_idx");
    expect(migration).toContain("store_approval_reviews_status_created_idx");
  });
});

describe("merchant onboarding location step migration", () => {
  const migration = readFileSync(
    join(process.cwd(), "prisma/migrations/20260523143000_add_onboarding_location_step/migration.sql"),
    "utf8"
  );

  it("adds enum values as standalone raw SQL before dependent state is used", () => {
    expect(migration).toContain("Do not wrap this migration in BEGIN/COMMIT");
    expect(migration).toContain('ALTER TYPE "OnboardingStep" ADD VALUE IF NOT EXISTS \'LOCATION\' BEFORE \'PREFERENCES\'');
    expect(migration).toContain('ALTER TYPE "OnboardingLifecycleState" ADD VALUE IF NOT EXISTS \'LOCATION_DONE\' BEFORE \'PREFS_DONE\'');
    expect(migration).not.toContain("BEGIN;");
    expect(migration).not.toContain("COMMIT;");
  });

  it("adds a nullable completion timestamp without changing store coordinate columns", () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "location_completed_at" TIMESTAMPTZ(3)');
    expect(migration).not.toContain('ADD COLUMN "latitude"');
    expect(migration).not.toContain('ADD COLUMN "longitude"');
  });
});

describe("merchant onboarding unused preference cleanup migration", () => {
  const migration = readFileSync(
    join(process.cwd(), "prisma/migrations/20260523150000_remove_unused_preference_columns/migration.sql"),
    "utf8"
  );

  it("drops deprecated preferences that are no longer collected", () => {
    expect(migration).toContain('DROP COLUMN IF EXISTS "shipping_preference"');
    expect(migration).toContain('DROP COLUMN IF EXISTS "notification_preferences"');
    expect(migration).toContain('DROP COLUMN IF EXISTS "theme_preset"');
  });
});

describe("product taxonomy repair migration", () => {
  const migration = readFileSync(
    join(process.cwd(), "prisma/migrations/20260525150000_ensure_product_taxonomy_columns/migration.sql"),
    "utf8"
  );

  it("keeps sub-category and type columns present without failing on already-migrated databases", () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "sub_category" TEXT');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "product_type" TEXT');
  });
});
