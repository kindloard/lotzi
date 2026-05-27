# Deployment Notes

Recommended production shape:

- Frontend: Vercel or equivalent.
- Backend: Render, Fly.io, Railway, ECS, or a VM with Node 20+.
- Database: Supabase PostgreSQL with direct migration URL and pooled runtime URL.
- Redis: managed Redis for rate limiting and authz cache.
- Email: Resend transactional API.

## Auth Deployment Checklist

- Set `DATABASE_URL` to the pooled runtime URL and `DIRECT_URL` to the direct migration URL.
- Configure exact `ALLOWED_ORIGINS`; never use wildcard CORS with credentials.
- Configure Resend, Firebase Admin, JWT Ed25519 key pair, token peppers, and admin allowlist in a secret manager.
- Run `npx prisma migrate deploy` before starting backend instances.
- Run `npm run auth:bootstrap-admin` once after deploy when creating first admins.
- Keep Prisma connection limits aligned with PgBouncer/Supabase pool size.
- Monitor `/api/internal/metrics` for auth failures, refresh reuse, OTP abuse, Redis failures, and email queue age.
- Keep the backend runtime in the same region as Supabase/PostgreSQL or use the nearest pooled
  database endpoint. Auth targets assume low DB round-trip latency; a 1s+ backend-to-DB hop will
  dominate OTP and login even when queries use indexes.

## Secret Rotation

- JWT keys rotate by adding a new `JWT_KEY_ID`/private key and keeping old public keys available during token TTL.
- Pepper rotation should be versioned; high-risk rotations require refresh-token family revocation.
- Firebase and Resend credentials are server-only and must never be exposed to the frontend.

## Firebase Admin Key Incident Response

- Treat any Firebase Admin service-account JSON found on a developer machine or in Git history as compromised.
- Rotate and delete the exposed key in the Firebase console before production deploy.
- Update runtime secrets through `FIREBASE_SERVICE_ACCOUNT_JSON` or the split `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY` values.
- Verify no `*firebase-adminsdk*.json` file is tracked by Git, and keep local JSON key files ignored.
