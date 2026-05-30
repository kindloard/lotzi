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
    PRISMA_TRANSACTION_MAX_WAIT_MS: z.coerce.number().int().positive().default(10_000),
    PRISMA_TRANSACTION_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
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
    CASHFREE_ENV: z.enum(["sandbox", "production"]).default("sandbox"),
    CASHFREE_BASE_URL: optionalString.pipe(z.url().optional()),
    CASHFREE_API_VERSION: z.string().default("2025-01-01"),
    CASHFREE_APP_ID: optionalString,
    CASHFREE_SECRET_KEY: optionalString,
    CASHFREE_WEBHOOK_SECRET: optionalString,
    CASHFREE_RETURN_URL: optionalString.pipe(z.url().optional()),
    CASHFREE_NOTIFY_URL: optionalString.pipe(z.url().optional()),
    PHONE_CHECKOUT_ONBOARDING_ENABLED: booleanFromStringDefault(true),
    FAST2SMS_API_KEY: optionalString,
    FAST2SMS_OTP_MODE: z.enum(["BULKV2_OTP", "TEMPLATE_OTP", "DLT_SMS", "QUICK_SMS"]).default("BULKV2_OTP"),
    FAST2SMS_OTP_TEMPLATE_ID: optionalString,
    FAST2SMS_DLT_SENDER_ID: optionalString,
    FAST2SMS_DLT_MESSAGE_ID: optionalString,
    FAST2SMS_DLT_VARIABLES_TEMPLATE: z.string().default("{otp}"),
    FAST2SMS_QUICK_SMS_TEMPLATE: z.string().default("Your Namastore verification code is {otp}. It expires in {minutes} minutes."),
    FAST2SMS_BASE_URL: optionalString.pipe(z.url().optional()),
    FAST2SMS_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
    FAST2SMS_RETRY_COUNT: z.coerce.number().int().min(0).default(1),
    FAST2SMS_CIRCUIT_FAILURE_THRESHOLD: z.coerce.number().int().positive().default(5),
    FAST2SMS_CIRCUIT_OPEN_MS: z.coerce.number().int().positive().default(60_000),
    PHONE_OTP_TTL_SECONDS: z.coerce.number().int().positive().default(300),
    PHONE_OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
    PHONE_OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().positive().default(30),
    PHONE_OTP_BLOCK_SECONDS: z.coerce.number().int().positive().default(900),
    CHECKOUT_ONBOARDING_FLOW_TTL_SECONDS: z.coerce.number().int().positive().default(900),
    CHECKOUT_PHONE_PROOF_TTL_SECONDS: z.coerce.number().int().positive().default(600),
    CHECKOUT_ONBOARDING_ENCRYPTION_KEY: z.string().min(32).optional(),
    CHECKOUT_PHONE_PROOF_PEPPER: z.string().min(32).optional(),
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
      "INTERNAL_METRICS_TOKEN",
      "CASHFREE_APP_ID",
      "CASHFREE_SECRET_KEY"
    ];

    if (value.PHONE_CHECKOUT_ONBOARDING_ENABLED) {
      required.push(
        "FAST2SMS_API_KEY",
        "CHECKOUT_ONBOARDING_ENCRYPTION_KEY",
        "CHECKOUT_PHONE_PROOF_PEPPER"
      );
      if (value.FAST2SMS_OTP_MODE === "TEMPLATE_OTP") {
        required.push("FAST2SMS_OTP_TEMPLATE_ID");
      }
      if (value.FAST2SMS_OTP_MODE === "DLT_SMS") {
        required.push("FAST2SMS_DLT_SENDER_ID", "FAST2SMS_DLT_MESSAGE_ID");
      }
    }

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
    FAST2SMS_BASE_URL: parsed.FAST2SMS_BASE_URL ?? "https://www.fast2sms.com",
    CHECKOUT_ONBOARDING_ENCRYPTION_KEY:
      parsed.CHECKOUT_ONBOARDING_ENCRYPTION_KEY ??
      "local-dev-checkout-onboarding-key-change-before-prod",
    CHECKOUT_PHONE_PROOF_PEPPER:
      parsed.CHECKOUT_PHONE_PROOF_PEPPER ??
      "local-dev-checkout-phone-proof-change-before-prod",
    ADMIN_APPROVAL_SESSION_SECRET:
      parsed.ADMIN_APPROVAL_SESSION_SECRET ??
      "local-dev-admin-approval-session-secret-change-before-prod"
  };
}
