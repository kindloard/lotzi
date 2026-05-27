# API Notes

Base URL in development:

```txt
http://localhost:4000/api
```

Frontend calls must use `credentials: "include"` and send `x-csrf-token` for authenticated state-changing requests.

## Auth Endpoints

- `POST /auth/signup`
  - Customer body: `{ name, email, password, accountType: "CUSTOMER" }`
  - Merchant body: `{ name, email, password, accountType: "MERCHANT", storeName }`
- `POST /auth/signup/verify`
- `POST /auth/otp/resend`
- `POST /auth/login`
- `POST /auth/google`
  - Customer login/signup only. Merchant onboarding must use email/password signup.
- `POST /auth/google/link`
- `POST /auth/password-reset/request`
- `POST /auth/password-reset/confirm`
- `POST /auth/refresh`
- `POST /auth/logout`
- `GET /auth/session`
- `GET /auth/sessions`
- `DELETE /auth/sessions/:id`

## Merchant Onboarding Endpoints

All merchant onboarding endpoints require an authenticated merchant-owner session. State-changing requests require `x-csrf-token`.

- `GET /merchant/onboarding`: returns store identity, onboarding state, saved normalized data, drafts, and country/business validation rules. Location coordinates are returned as plain JSON numbers.
- `PATCH /merchant/onboarding/drafts/:step`: autosaves one step payload with optional draft version conflict detection.
- `POST /merchant/onboarding/steps/:step/complete`: validates one step, persists normalized data, and advances the state machine. The `LOCATION` step requires GPS latitude/longitude and rejects captures with accuracy over 200 meters.
- `POST /merchant/onboarding/media/signature`: returns a scoped Cloudinary signature for logo/banner uploads.
- `POST /merchant/onboarding/media/attach`: validates uploaded media metadata and attaches it to the store.
- `POST /merchant/onboarding/launch`: idempotently validates all setup data, submits the store profile for approval review, moves the store to approval pending, and enqueues async review events.

## V1 Upload And Product Endpoints

All `/v1/merchant/products` mutations require an authenticated merchant session, `x-csrf-token`, and `x-store-id` or `storeId`.

- `GET /v1/uploads/capabilities`: returns runtime Sharp/libvips image input support and upload policies.
- `POST /v1/uploads/images`: multipart product image upload. The backend validates magic bytes, decodes dimensions, generates optimized renditions, uploads them to Cloudinary, and returns a reusable `UploadAsset`.
- `POST /v1/uploads/maintenance/sweep`: platform-admin bounded orphan cleanup entrypoint for external cron/manual operations.
- `GET /v1/merchant/products?storeId=:id`: returns DB-backed merchant products with ordered image renditions.
- `POST /v1/merchant/products`: creates a product and transactionally attaches ready upload assets as product images.
- `PATCH /v1/merchant/products/:productId`: supports sparse product metadata updates when the body includes `expectedCatalogVersion`. A name-only edit should send `{ storeId, expectedCatalogVersion, name }` and must not include `images` or `variants`. Stale versions return `409 PRODUCT_VERSION_CONFLICT`; identical retries after a committed write are safe and return the current product metadata. Legacy full-graph payloads remain accepted during rollout.
- `PATCH /v1/merchant/products/:productId/images/order`: updates product image order and primary image.
- `POST /v1/merchant/products/:productId/images/:imageId/replace`: replaces a product image with another ready upload asset.
- `DELETE /v1/merchant/products/:productId/images/:imageId`: removes a product image and marks its upload asset for cleanup.

V1 upload errors use `{ apiVersion, code, message, retryable, retryAfterSeconds?, details? }` so clients can retry without parsing text.

## Response Rules

- Signup, reset request, and OTP resend responses are enumeration-safe.
- Google/password email conflict returns `409` with code `LINK_REQUIRED`.
- Rate limits return `429` with `retryAfterSeconds`.
- Auth cookies are httpOnly; the frontend reads only the CSRF cookie and session metadata response.
