-- Multi-tenant identity, store membership, and data-driven RBAC.

CREATE TYPE "RoleScope" AS ENUM ('PLATFORM', 'STORE');
CREATE TYPE "StoreMemberStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'REMOVED');
CREATE TYPE "KycStatus" AS ENUM ('NOT_SUBMITTED', 'PENDING', 'VERIFIED', 'REJECTED', 'EXPIRED');
CREATE TYPE "PayoutStatus" AS ENUM ('NOT_CONFIGURED', 'PENDING', 'VERIFIED', 'REJECTED', 'DISABLED');

ALTER TYPE "ShopStatus" RENAME TO "StoreStatus";

DROP POLICY IF EXISTS order_owner_or_shop_owner_policy ON "orders";
DROP POLICY IF EXISTS shop_owner_or_public_read_policy ON "shops";

ALTER TABLE "users" RENAME COLUMN "last_login" TO "last_login_at";
ALTER TABLE "users" ADD COLUMN "deleted_at" TIMESTAMPTZ(3);

ALTER TABLE "identity_providers"
  ADD COLUMN "metadata" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "last_login_at" TIMESTAMPTZ(3);

ALTER TABLE "otp_verifications"
  ADD COLUMN "metadata" JSONB NOT NULL DEFAULT '{}';

ALTER TABLE "audit_logs" DISABLE TRIGGER audit_logs_immutable_update;
ALTER TABLE "audit_logs" DISABLE TRIGGER audit_logs_immutable_delete;
ALTER TABLE "audit_logs" RENAME COLUMN "ip" TO "ip_address";
ALTER TABLE "audit_logs" RENAME COLUMN "timestamp" TO "created_at";
ALTER TABLE "audit_logs" ADD COLUMN "store_id" UUID;
ALTER TABLE "audit_logs" ENABLE TRIGGER audit_logs_immutable_update;
ALTER TABLE "audit_logs" ENABLE TRIGGER audit_logs_immutable_delete;
ALTER INDEX IF EXISTS "audit_logs_event_type_timestamp_idx" RENAME TO "audit_logs_event_type_created_at_idx";
ALTER INDEX IF EXISTS "audit_logs_actor_user_id_timestamp_idx" RENAME TO "audit_logs_actor_user_id_created_at_idx";

ALTER TABLE "shops" RENAME TO "stores";
ALTER TABLE "stores" RENAME COLUMN "owner_id" TO "created_by_user_id";
ALTER TABLE "stores"
  ADD COLUMN "approved_by_user_id" UUID,
  ADD COLUMN "legal_name" TEXT,
  ADD COLUMN "email" CITEXT,
  ADD COLUMN "approved_at" TIMESTAMPTZ(3),
  ADD COLUMN "rejection_reason" TEXT,
  ADD COLUMN "deleted_at" TIMESTAMPTZ(3);
ALTER TABLE "stores"
  ALTER COLUMN "address_line" DROP NOT NULL,
  ALTER COLUMN "city" DROP NOT NULL,
  ALTER COLUMN "state" DROP NOT NULL,
  ALTER COLUMN "pincode" DROP NOT NULL,
  ALTER COLUMN "latitude" DROP NOT NULL,
  ALTER COLUMN "longitude" DROP NOT NULL;

ALTER TABLE "products" RENAME COLUMN "shop_id" TO "store_id";
ALTER TABLE "carts" RENAME COLUMN "shop_id" TO "store_id";
ALTER TABLE "orders" RENAME COLUMN "shop_id" TO "store_id";

ALTER INDEX IF EXISTS "shops_slug_key" RENAME TO "stores_slug_key";
ALTER INDEX IF EXISTS "shops_owner_id_status_idx" RENAME TO "stores_created_by_user_id_status_idx";
ALTER INDEX IF EXISTS "products_shop_id_is_active_idx" RENAME TO "products_store_id_is_active_idx";
ALTER INDEX IF EXISTS "orders_shop_id_status_idx" RENAME TO "orders_store_id_status_idx";

ALTER TABLE "stores" RENAME CONSTRAINT "shops_pkey" TO "stores_pkey";
ALTER TABLE "stores" RENAME CONSTRAINT "shops_owner_id_fkey" TO "stores_created_by_user_id_fkey";
ALTER TABLE "products" RENAME CONSTRAINT "products_shop_id_fkey" TO "products_store_id_fkey";
ALTER TABLE "carts" RENAME CONSTRAINT "carts_shop_id_fkey" TO "carts_store_id_fkey";
ALTER TABLE "orders" RENAME CONSTRAINT "orders_shop_id_fkey" TO "orders_store_id_fkey";

ALTER TABLE "stores"
  ADD CONSTRAINT "stores_approved_by_user_id_fkey"
  FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "customer_profiles" (
  "user_id" UUID NOT NULL,
  "display_name" TEXT,
  "phone" TEXT,
  "marketing_opt_in" BOOLEAN NOT NULL DEFAULT false,
  "loyalty_tier" TEXT NOT NULL DEFAULT 'STANDARD',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "customer_profiles_pkey" PRIMARY KEY ("user_id")
);

CREATE TABLE "merchant_profiles" (
  "user_id" UUID NOT NULL,
  "business_name" TEXT NOT NULL,
  "legal_name" TEXT,
  "gstin" VARCHAR(15),
  "pan_last4" VARCHAR(4),
  "kyc_status" "KycStatus" NOT NULL DEFAULT 'NOT_SUBMITTED',
  "kyc_provider" TEXT,
  "kyc_reference" TEXT,
  "encrypted_kyc_data" JSONB,
  "payout_status" "PayoutStatus" NOT NULL DEFAULT 'NOT_CONFIGURED',
  "payout_account_last4" VARCHAR(4),
  "payout_ifsc" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "merchant_profiles_pkey" PRIMARY KEY ("user_id")
);

CREATE TABLE "roles" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "scope" "RoleScope" NOT NULL,
  "is_system" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "permissions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" TEXT NOT NULL,
  "description" TEXT,
  "scope" "RoleScope" NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "role_permissions" (
  "role_id" UUID NOT NULL,
  "permission_id" UUID NOT NULL,
  CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id", "permission_id")
);

CREATE TABLE "user_roles" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "role_id" UUID NOT NULL,
  "assigned_by_user_id" UUID,
  "assigned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revoked_at" TIMESTAMPTZ(3),
  CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "store_members" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "store_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "role_id" UUID NOT NULL,
  "status" "StoreMemberStatus" NOT NULL DEFAULT 'PENDING',
  "invited_by_user_id" UUID,
  "joined_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "store_members_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");
CREATE INDEX "roles_scope_idx" ON "roles"("scope");
CREATE UNIQUE INDEX "permissions_code_key" ON "permissions"("code");
CREATE INDEX "permissions_scope_idx" ON "permissions"("scope");
CREATE UNIQUE INDEX "merchant_profiles_gstin_key" ON "merchant_profiles"("gstin");
CREATE INDEX "merchant_profiles_kyc_status_idx" ON "merchant_profiles"("kyc_status");
CREATE INDEX "merchant_profiles_payout_status_idx" ON "merchant_profiles"("payout_status");
CREATE INDEX "user_roles_user_id_revoked_at_idx" ON "user_roles"("user_id", "revoked_at");
CREATE INDEX "user_roles_role_id_revoked_at_idx" ON "user_roles"("role_id", "revoked_at");
CREATE UNIQUE INDEX "user_roles_active_user_role_key" ON "user_roles"("user_id", "role_id") WHERE "revoked_at" IS NULL;
CREATE INDEX "store_members_user_id_status_idx" ON "store_members"("user_id", "status");
CREATE INDEX "store_members_store_id_status_idx" ON "store_members"("store_id", "status");
CREATE INDEX "store_members_role_id_status_idx" ON "store_members"("role_id", "status");
CREATE UNIQUE INDEX "store_members_active_store_user_key" ON "store_members"("store_id", "user_id") WHERE "status" <> 'REMOVED';
CREATE INDEX "stores_status_deleted_at_idx" ON "stores"("status", "deleted_at");
CREATE INDEX "carts_store_id_idx" ON "carts"("store_id");
CREATE INDEX "audit_logs_store_id_created_at_idx" ON "audit_logs"("store_id", "created_at");

ALTER TABLE "customer_profiles"
  ADD CONSTRAINT "customer_profiles_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "merchant_profiles"
  ADD CONSTRAINT "merchant_profiles_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "role_permissions"
  ADD CONSTRAINT "role_permissions_role_id_fkey"
  FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "role_permissions_permission_id_fkey"
  FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_roles"
  ADD CONSTRAINT "user_roles_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "user_roles_role_id_fkey"
  FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "user_roles_assigned_by_user_id_fkey"
  FOREIGN KEY ("assigned_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "store_members"
  ADD CONSTRAINT "store_members_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "store_members_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "store_members_role_id_fkey"
  FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "store_members_invited_by_user_id_fkey"
  FOREIGN KEY ("invited_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "audit_logs" DISABLE TRIGGER audit_logs_immutable_update;
ALTER TABLE "audit_logs" DISABLE TRIGGER audit_logs_immutable_delete;

UPDATE "audit_logs" al
SET
  "metadata" = jsonb_set(
    COALESCE(al."metadata", '{}'::jsonb),
    '{orphan_actor_user_id}',
    to_jsonb(al."actor_user_id"::text),
    true
  ),
  "actor_user_id" = NULL
WHERE al."actor_user_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "users" u
    WHERE u."id" = al."actor_user_id"
  );

UPDATE "audit_logs" al
SET
  "metadata" = jsonb_set(
    COALESCE(al."metadata", '{}'::jsonb),
    '{orphan_session_id}',
    to_jsonb(al."session_id"::text),
    true
  ),
  "session_id" = NULL
WHERE al."session_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "sessions" s
    WHERE s."id" = al."session_id"
  );

ALTER TABLE "audit_logs" ENABLE TRIGGER audit_logs_immutable_update;
ALTER TABLE "audit_logs" ENABLE TRIGGER audit_logs_immutable_delete;

ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "audit_logs_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "audit_logs_session_id_fkey"
  FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DO $$
DECLARE
  item record;
BEGIN
  FOR item IN
    SELECT * FROM (VALUES
      ('users', 'locked_until'),
      ('users', 'last_login_at'),
      ('users', 'password_changed_at'),
      ('users', 'created_at'),
      ('users', 'updated_at'),
      ('identity_providers', 'linked_at'),
      ('otp_verifications', 'verified_at'),
      ('otp_verifications', 'expires_at'),
      ('otp_verifications', 'cooldown_until'),
      ('otp_verifications', 'created_at'),
      ('otp_verifications', 'updated_at'),
      ('sessions', 'expires_at'),
      ('sessions', 'revoked_at'),
      ('sessions', 'last_seen_at'),
      ('sessions', 'created_at'),
      ('sessions', 'updated_at'),
      ('refresh_token_history', 'consumed_at'),
      ('refresh_token_history', 'expires_at'),
      ('refresh_token_history', 'reuse_detected_at'),
      ('password_resets', 'consumed_at'),
      ('password_resets', 'expires_at'),
      ('password_resets', 'created_at'),
      ('audit_logs', 'created_at'),
      ('audit_outbox', 'next_run_at'),
      ('audit_outbox', 'created_at'),
      ('audit_outbox', 'sent_at'),
      ('email_outbox', 'next_attempt_at'),
      ('email_outbox', 'created_at'),
      ('email_outbox', 'sent_at'),
      ('addresses', 'created_at'),
      ('addresses', 'updated_at'),
      ('stores', 'created_at'),
      ('stores', 'updated_at'),
      ('categories', 'created_at'),
      ('categories', 'updated_at'),
      ('products', 'created_at'),
      ('products', 'updated_at'),
      ('carts', 'created_at'),
      ('carts', 'updated_at'),
      ('cart_items', 'created_at'),
      ('cart_items', 'updated_at'),
      ('orders', 'created_at'),
      ('orders', 'updated_at'),
      ('order_items', 'created_at'),
      ('payments', 'created_at'),
      ('payments', 'updated_at')
    ) AS columns(table_name, column_name)
  LOOP
    EXECUTE format(
      'ALTER TABLE %I ALTER COLUMN %I TYPE TIMESTAMPTZ(3) USING %I AT TIME ZONE ''UTC''',
      item.table_name,
      item.column_name,
      item.column_name
    );
  END LOOP;
END $$;

INSERT INTO "roles" ("code", "name", "description", "scope", "is_system", "updated_at")
VALUES
  ('PLATFORM_SUPER_ADMIN', 'Platform Super Admin', 'Full platform administration access.', 'PLATFORM', true, CURRENT_TIMESTAMP),
  ('CUSTOMER', 'Customer', 'Default buyer permissions.', 'PLATFORM', true, CURRENT_TIMESTAMP),
  ('MERCHANT_OWNER', 'Merchant Owner', 'Store owner with full store administration access.', 'STORE', true, CURRENT_TIMESTAMP),
  ('STORE_MANAGER', 'Store Manager', 'Store staff manager with operational access.', 'STORE', true, CURRENT_TIMESTAMP),
  ('STORE_STAFF', 'Store Staff', 'Store staff with limited order and catalog access.', 'STORE', true, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "permissions" ("code", "description", "scope", "updated_at")
VALUES
  ('profile:read', 'Read own profile.', 'PLATFORM', CURRENT_TIMESTAMP),
  ('profile:write', 'Update own profile.', 'PLATFORM', CURRENT_TIMESTAMP),
  ('cart:write', 'Manage own cart.', 'PLATFORM', CURRENT_TIMESTAMP),
  ('order:create', 'Create customer orders.', 'PLATFORM', CURRENT_TIMESTAMP),
  ('order:read:own', 'Read own customer orders.', 'PLATFORM', CURRENT_TIMESTAMP),
  ('admin:users', 'Manage platform users.', 'PLATFORM', CURRENT_TIMESTAMP),
  ('admin:stores', 'Manage platform stores.', 'PLATFORM', CURRENT_TIMESTAMP),
  ('admin:orders', 'Manage platform orders.', 'PLATFORM', CURRENT_TIMESTAMP),
  ('admin:system', 'Manage internal platform settings.', 'PLATFORM', CURRENT_TIMESTAMP),
  ('store:read', 'Read assigned store data.', 'STORE', CURRENT_TIMESTAMP),
  ('store:manage', 'Manage assigned store settings.', 'STORE', CURRENT_TIMESTAMP),
  ('store:staff:manage', 'Manage staff for assigned store.', 'STORE', CURRENT_TIMESTAMP),
  ('product:manage', 'Manage products for assigned store.', 'STORE', CURRENT_TIMESTAMP),
  ('order:manage:store', 'Manage orders for assigned store.', 'STORE', CURRENT_TIMESTAMP),
  ('upload:store', 'Upload assets for assigned store.', 'STORE', CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
JOIN "permissions" p ON (
  r."code" = 'PLATFORM_SUPER_ADMIN'
  OR (r."code" = 'CUSTOMER' AND p."code" IN ('profile:read', 'profile:write', 'cart:write', 'order:create', 'order:read:own'))
  OR (r."code" = 'MERCHANT_OWNER' AND p."code" IN ('store:read', 'store:manage', 'store:staff:manage', 'product:manage', 'order:manage:store', 'upload:store'))
  OR (r."code" = 'STORE_MANAGER' AND p."code" IN ('store:read', 'store:manage', 'product:manage', 'order:manage:store', 'upload:store'))
  OR (r."code" = 'STORE_STAFF' AND p."code" IN ('store:read', 'product:manage', 'order:manage:store', 'upload:store'))
)
ON CONFLICT DO NOTHING;

INSERT INTO "customer_profiles" ("user_id", "display_name", "phone", "updated_at")
SELECT "id", "full_name", "phone", CURRENT_TIMESTAMP
FROM "users"
ON CONFLICT ("user_id") DO NOTHING;

INSERT INTO "merchant_profiles" ("user_id", "business_name", "updated_at")
SELECT DISTINCT s."created_by_user_id", COALESCE(u."full_name", s."name", 'Merchant'), CURRENT_TIMESTAMP
FROM "stores" s
JOIN "users" u ON u."id" = s."created_by_user_id"
ON CONFLICT ("user_id") DO NOTHING;

INSERT INTO "user_roles" ("user_id", "role_id")
SELECT u."id", r."id"
FROM "users" u
JOIN "roles" r ON r."code" = 'CUSTOMER'
ON CONFLICT DO NOTHING;

INSERT INTO "user_roles" ("user_id", "role_id")
SELECT u."id", r."id"
FROM "users" u
JOIN "roles" r ON r."code" = 'PLATFORM_SUPER_ADMIN'
WHERE u."role" = 'ADMIN'
ON CONFLICT DO NOTHING;

INSERT INTO "store_members" ("store_id", "user_id", "role_id", "status", "joined_at", "updated_at")
SELECT s."id", s."created_by_user_id", r."id", 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "stores" s
JOIN "roles" r ON r."code" = 'MERCHANT_OWNER'
ON CONFLICT DO NOTHING;

ALTER TABLE "users" DROP COLUMN "role";
DROP TYPE "UserRole";

CREATE POLICY order_owner_or_store_member_policy ON "orders"
  USING (
    "user_id"::text = current_setting('app.current_user_id', true)
    OR EXISTS (
      SELECT 1
      FROM "store_members" sm
      WHERE sm."store_id" = "orders"."store_id"
        AND sm."user_id"::text = current_setting('app.current_user_id', true)
        AND sm."status" = 'ACTIVE'
    )
    OR current_setting('app.is_platform_admin', true) = 'true'
  );

CREATE POLICY store_member_or_public_read_policy ON "stores"
  USING (
    "status" = 'APPROVED'
    OR "created_by_user_id"::text = current_setting('app.current_user_id', true)
    OR EXISTS (
      SELECT 1
      FROM "store_members" sm
      WHERE sm."store_id" = "stores"."id"
        AND sm."user_id"::text = current_setting('app.current_user_id', true)
        AND sm."status" = 'ACTIVE'
    )
    OR current_setting('app.is_platform_admin', true) = 'true'
  )
  WITH CHECK (
    "created_by_user_id"::text = current_setting('app.current_user_id', true)
    OR EXISTS (
      SELECT 1
      FROM "store_members" sm
      JOIN "roles" r ON r."id" = sm."role_id"
      WHERE sm."store_id" = "stores"."id"
        AND sm."user_id"::text = current_setting('app.current_user_id', true)
        AND sm."status" = 'ACTIVE'
        AND r."code" IN ('MERCHANT_OWNER', 'STORE_MANAGER')
    )
    OR current_setting('app.is_platform_admin', true) = 'true'
  );
