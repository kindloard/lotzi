import { z } from "zod";

const booleanFromString = z
  .string()
  .optional()
  .transform((value) => value === "true");

const booleanFromStringDefault = (defaultValue: boolean) =>
  z
    .string()
    .optional()
    .transform((value) => (value === undefined ? defaultValue : value === "true"));

const optionalString = z
  .string()
  .optional()
  .transform((value) => (value?.trim() ? value : undefined));

const optionalEmail = optionalString.pipe(z.email().optional());

const csv = z
  .string()
  .optional()
  .transform((value) =>
    value
      ? value
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      : []
  );

export const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z.string().min(1),
    DIRECT_URL: optionalString,
    SUPABASE_URL: optionalString.pipe(z.url().optional()),
    FRONTEND_URL: z.string().url().default("http://localhost:3000"),
    ALLOWED_ORIGINS: csv,
    PORT: z.coerce.number().int().positive().default(4000),
    COOKIE_DOMAIN: optionalString,
    COOKIE_SAME_SITE: z.enum(["lax", "strict", "none"]).default("lax"),
    REDIS_URL: optionalString,
    RESEND_API_KEY: optionalString,
    RESEND_FROM_EMAIL: optionalEmail,
    FIREBASE_PROJECT_ID: optionalString,
    FIREBASE_CLIENT_EMAIL: optionalEmail,
    FIREBASE_PRIVATE_KEY: optionalString,
    FIREBASE_SERVICE_ACCOUNT_PATH: optionalString,
    FIREBASE_SERVICE_ACCOUNT_JSON: optionalString,
    GOOGLE_MAPS_API_KEY: optionalString,
    JWT_KEY_ID: z.string().default("local-dev"),
    JWT_PRIVATE_KEY: optionalString,
    JWT_PUBLIC_KEY: optionalString,
    JWT_DEV_KEYPAIR_PATH: optionalString,
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
    AUTH_REFRESH_RACE_WINDOW_MS: z.coerce.number().int().positive().default(10_000),
    OTP_PEPPER: z.string().min(32).optional(),
    REFRESH_TOKEN_PEPPER: z.string().min(32).optional(),
    CLIENT_BINDING_PEPPER: z.string().min(32).optional(),
    PASSWORD_RESET_PEPPER: z.string().min(32).optional(),
    DEVICE_FINGERPRINT_PEPPER: z.string().min(32).optional(),
    CSRF_PEPPER: z.string().min(32).optional(),
    ADMIN_EMAILS: csv,
    ADMIN_APPROVAL_PASSWORD_HASH: optionalString,
    ADMIN_APPROVAL_PASSWORD: optionalString,
    ADMIN_APPROVAL_SESSION_SECRET: z.string().min(32).optional(),
    ADMIN_APPROVAL_SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
    INTERNAL_METRICS_TOKEN: optionalString,
    CLOUDINARY_CLOUD_NAME: optionalString,
    CLOUDINARY_API_KEY: optionalString,
    CLOUDINARY_API_SECRET: optionalString,
    CLOUDINARY_PRODUCT_UPLOAD_PRESET: optionalString,
    UPLOAD_PROCESSING_CONCURRENCY: z.coerce.number().int().positive().default(2),
    TRUST_PROXY_HEADERS: booleanFromString,
    AUTH_REQUIRE_STRICT_SECRETS: booleanFromString,
    AUTH_REMEMBER_ME_ENABLED: booleanFromStringDefault(true),
    AUTH_RESET_HASH_LINKS_ENABLED: booleanFromStringDefault(true)
  })
  .superRefine((value, ctx) => {
    const strict = value.NODE_ENV === "production" || value.AUTH_REQUIRE_STRICT_SECRETS;
    if (!strict) {
      return;
    }

    const required: Array<keyof typeof value> = [
      "DIRECT_URL",
      "REDIS_URL",
      "RESEND_API_KEY",
      "RESEND_FROM_EMAIL",
      "JWT_PRIVATE_KEY",
      "JWT_PUBLIC_KEY",
      "OTP_PEPPER",
      "REFRESH_TOKEN_PEPPER",
      "CLIENT_BINDING_PEPPER",
      "PASSWORD_RESET_PEPPER",
      "DEVICE_FINGERPRINT_PEPPER",
      "CSRF_PEPPER",
      "ADMIN_APPROVAL_SESSION_SECRET",
      "ADMIN_APPROVAL_PASSWORD_HASH",
      "INTERNAL_METRICS_TOKEN"
    ];

    for (const key of required) {
      if (!value[key]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${key} is required when strict auth secrets are enabled.`,
          path: [key]
        });
      }
    }

    const hasFirebaseServiceAccount =
      Boolean(value.FIREBASE_SERVICE_ACCOUNT_PATH) ||
      Boolean(value.FIREBASE_SERVICE_ACCOUNT_JSON) ||
      Boolean(value.FIREBASE_PROJECT_ID && value.FIREBASE_CLIENT_EMAIL && value.FIREBASE_PRIVATE_KEY);

    if (!hasFirebaseServiceAccount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Firebase Admin credentials require FIREBASE_SERVICE_ACCOUNT_PATH, FIREBASE_SERVICE_ACCOUNT_JSON, or FIREBASE_PROJECT_ID/FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY.",
        path: ["FIREBASE_SERVICE_ACCOUNT_PATH"]
      });
    }
  });

export type AppEnv = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>) {
  const parsed = envSchema.parse(config);
  return {
    ...parsed,
    DIRECT_URL: parsed.DIRECT_URL ?? parsed.DATABASE_URL,
    ALLOWED_ORIGINS:
      parsed.ALLOWED_ORIGINS.length > 0
        ? parsed.ALLOWED_ORIGINS
        : [parsed.FRONTEND_URL],
    OTP_PEPPER: parsed.OTP_PEPPER ?? "local-dev-otp-pepper-change-before-prod-000000",
    REFRESH_TOKEN_PEPPER:
      parsed.REFRESH_TOKEN_PEPPER ??
      "local-dev-refresh-pepper-change-before-prod-000",
    CLIENT_BINDING_PEPPER:
      parsed.CLIENT_BINDING_PEPPER ??
      "local-dev-client-binding-pepper-change-before-prod-000",
    PASSWORD_RESET_PEPPER:
      parsed.PASSWORD_RESET_PEPPER ??
      "local-dev-reset-pepper-change-before-prod-00000",
    DEVICE_FINGERPRINT_PEPPER:
      parsed.DEVICE_FINGERPRINT_PEPPER ??
      "local-dev-device-pepper-change-before-prod-000",
    CSRF_PEPPER:
      parsed.CSRF_PEPPER ?? "local-dev-csrf-pepper-change-before-prod-0000",
    ADMIN_APPROVAL_SESSION_SECRET:
      parsed.ADMIN_APPROVAL_SESSION_SECRET ??
      "local-dev-admin-approval-session-secret-change-before-prod"
  };
}
