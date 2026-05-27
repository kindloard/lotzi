# Database Notes

PostgreSQL is the source of truth. Prisma manages typed access, and migrations use `DIRECT_URL`; runtime traffic should use a pooled Supabase/PgBouncer URL.

## Auth Tables

- `users`: canonical identity record, email/password status, lockout counters, and `authz_version`.
- `identity_providers`: external identity mappings. Google login resolves by `(provider, provider_user_id)` only.
- `customer_profiles`: buyer-specific profile state for users who purchase from stores.
- `merchant_profiles`: merchant business, KYC, and payout state.
- `stores`: tenant root for merchant storefronts.
- `store_members`: store-scoped user membership and role assignment.
- `roles`, `permissions`, and `role_permissions`: data-driven platform/store RBAC.
- `user_roles`: platform-scoped role assignments such as customer and super admin.
- `otp_verifications`: hashed OTPs, attempts, cooldown, expiry, verified state.
- `sessions`: current refresh hash, device fingerprint, token family, revocation state.
- `refresh_token_history`: consumed refresh hashes for reuse detection.
- `password_resets`: selector/verifier reset token records.
- `audit_logs`: immutable security event ledger.
- `audit_outbox` and `email_outbox`: durable async delivery queues.

## Merchant Onboarding Tables

- `store_business_profiles`: business category/type, country, legal/tax data, address, and verification status.
- `store_branding`: logo/banner media references, description, tagline, and colors.
- `store_settings`: business hours for merchant operations.
- `store_onboarding_states`: canonical lifecycle state from `PENDING` through `APPROVAL_PENDING` and `ACTIVE`, including GPS location completion.
- `store_onboarding_drafts`: write-heavy per-step draft payloads keyed by `(store_id, step)`.
- `store_media`: temporary and attached Cloudinary media with MIME, size, dimensions, checksum, and cleanup status.
- `store_approval_reviews`: approval queue state, risk score, and review metadata.
- `domain_events`: transactional outbox for onboarding, approval, analytics, and review-submission side effects.

## Product Catalog Tables

- `products`: merchant catalog product records. Category is normalized through `category_id`; merchant-facing taxonomy depth is stored as nullable `sub_category` and `product_type` columns so the upload form can persist category, sub-category, and type selections without forcing every taxonomy node into the global `categories` table.
- `categories`: top-level catalog category records used by products through `category_id`.
- `product_images`, `product_variants`, and `product_image_variants`: product media, sellable variants, and image-to-variant associations. `products.catalog_version` is the optimistic-concurrency token for merchant edits. `product_variants.is_default` marks the internal/base sellable variant used for product-level inventory and order continuity; merchant-visible variant tables must filter this row out.
- `upload_assets` and `upload_asset_renditions`: upload engine source files and optimized image renditions attached to product images.

## Migration Notes

The initial enterprise auth migration creates `citext` and `pgcrypto`, auth tables, indexes, RLS policies, and the `verify_signup_otp` SQL function. Supabase projects that do not allow `citext` must replace it with lower-case text plus functional unique indexes before running the migration.

The auth performance migration adds partial indexes for pending OTP lookup, active session listing, and pending merchant store lookup. Verify with `EXPLAIN (ANALYZE, BUFFERS)` that OTP/session hot queries use these indexes and stay below 10 ms p95 on production-sized data.

The merchant onboarding migration intentionally keeps most onboarding data out of `stores`. GPS latitude/longitude reuse the existing nullable `stores` coordinate columns, while step completion stays in `store_onboarding_states`. Verify onboarding bootstrap uses primary-key joins by store id, autosave uses `store_onboarding_drafts(store_id, step)`, approval queues use `store_approval_reviews(status, created_at)`, and media cleanup uses `store_media(status, expires_at)`.

The product taxonomy repair migration uses `ADD COLUMN IF NOT EXISTS` for `products.sub_category` and `products.product_type`. This is intentional: it fixes environments where migration history and physical table shape drifted during the product upload taxonomy rollout, while staying safe for already-migrated databases.

Runtime DB users should not own tables and should not have `BYPASSRLS`. Auth tables are protected by grants and service-layer authorization; tenant-owned business tables additionally use RLS with `app.current_user_id`, `app.current_store_id`, and `app.is_platform_admin`.
