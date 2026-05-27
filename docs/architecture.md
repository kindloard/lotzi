# Architecture

Namastore is a Next.js frontend and NestJS backend backed by Supabase-managed PostgreSQL. The backend owns all identity, sessions, JWT issuance, refresh token lifecycle, revocation, RBAC, and audit logging.

## Auth Ownership

- Backend/Postgres is the only source of truth for users and sessions.
- Firebase Auth is used only to prove Google identity. The backend verifies a Firebase ID token once, maps it to `identity_providers`, then creates a Namastore session.
- Supabase is used only as PostgreSQL. Supabase Auth is not used.
- Refresh tokens are opaque, rotated, hashed at rest, and tracked by token family.
- Access tokens are short-lived backend JWTs with `authz_version` for role/status invalidation.
- Authorization is hybrid multi-tenant: `users` own identity, platform roles live in `user_roles`, store roles live in `store_members`, and profile tables hold customer/merchant-specific data.

## Request Flow

1. Frontend calls backend auth endpoints with `credentials: "include"`.
2. Backend validates request DTOs, applies Redis-backed rate limits, resolves tenant context for store requests, and performs service-layer authorization.
3. Backend reads/writes PostgreSQL through Prisma using a least-privilege runtime DB role.
4. Backend sets httpOnly secure cookies for access and refresh tokens, plus a readable CSRF cookie.
5. Audit events are written to immutable `audit_logs` and queued in `audit_outbox`.

## Auth Performance Budgets

- OTP verification backend p95 must stay below 300 ms, excluding network time.
- Password login backend p95 must stay below 200 ms, excluding network time.
- Session fetch backend p95 must stay below 100 ms.
- Auth endpoints emit `Server-Timing` and Prometheus `namastore_auth_step_duration_seconds`
  samples so rate limit, OTP lookup, SQL verify, session insert, JWT signing, RBAC, and
  email enqueue time can be tracked separately.

## Merchant Onboarding

- Merchant OTP success routes to `/merchant/onboarding`, where setup is driven by a backend state machine instead of loose UI-only steps.
- `stores` remains the lean tenant identity row. Business profile, branding, settings, drafts, media, approval review, and onboarding state live in normalized store-owned tables.
- Shop GPS capture is a required onboarding step before preferences. The browser must provide a fresh high-accuracy fix; the backend rounds and stores only latitude/longitude on the existing store row.
- Draft autosave writes one small `(store_id, step)` payload at a time to avoid fat-row contention.
- Review submission is idempotent: final validation and state changes happen in one transaction, then domain events enqueue approval, analytics, welcome email, and cleanup work asynchronously.
- Submitted stores enter an approval-pending dashboard state before public activation.

## Security Boundaries

- Google login resolves existing users by stable Google provider id, never by email after provider linking.
- Google login/signup is customer-only; merchant onboarding uses email/password plus OTP.
- Existing password accounts are never silently merged with Google accounts; users must reauthenticate with password.
- OTP verification uses an atomic PostgreSQL function to prevent replay and double-submit races.
- Redis outage policy is fail-open with emergency in-process throttling and critical alerts.
- Resend outage policy is durable email outbox plus retry; if outbox storage fails, auth email endpoints return retryable `503`.
