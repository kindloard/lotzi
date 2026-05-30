import { z } from "zod";

type TranslationFn = (key: string, values?: Record<string, number | string>) => string;

const englishAuthMessages: Record<string, string> = {
  "validation.emailInvalid": "Enter a valid email address.",
  "validation.identifierInvalid": "Enter a valid email or Indian mobile number.",
  "validation.nameRequired": "Enter your name.",
  "validation.otpLength": "Enter the {length}-digit code.",
  "validation.passwordMin": "Password must be at least {min} characters.",
  "validation.passwordMismatch": "Passwords do not match.",
  "validation.passwordNumber": "Add at least one number.",
  "validation.passwordRequired": "Enter your password.",
  "validation.passwordSymbol": "Add at least one symbol.",
  "validation.storeNameRequired": "Enter your store name."
};

const defaultT: TranslationFn = (key, values = {}) => {
  let template = englishAuthMessages[key] ?? key;
  for (const [name, value] of Object.entries(values)) {
    template = template.replaceAll(`{${name}}`, String(value));
  }
  return template;
};

export const PASSWORD_POLICY_MESSAGE = "Use 8-128 characters with at least one number or symbol.";

const passwordPolicyPattern = /(?:\d|[^A-Za-z0-9])/;

export function createPasswordSchema(t: TranslationFn = defaultT) {
  return z
    .string()
    .min(8, t("validation.passwordMin", { min: 8 }))
    .max(128, "Use 128 characters or fewer.")
    .regex(passwordPolicyPattern, t("validation.passwordSymbol"));
}

export function createLoginSchema(t: TranslationFn = defaultT) {
  return z.object({
    email: z
      .string()
      .trim()
      .refine((value) => isEmail(value) || isIndianLoginPhone(value), t("validation.identifierInvalid"))
      .transform((value) => value.includes("@") ? value.trim().toLowerCase() : value.trim()),
    password: z.string().min(1, t("validation.passwordRequired")),
    remember: z.boolean()
  });
}

export function createSignupSchema(t: TranslationFn = defaultT) {
  return z.object({
    name: z.string().trim().min(2, t("validation.nameRequired")).max(120, "Use 120 characters or fewer."),
    storeName: z.string().trim().optional(),
    email: z.email(t("validation.emailInvalid")).transform((value) => value.trim().toLowerCase()),
    password: createPasswordSchema(t),
    accountType: z.enum(["CUSTOMER", "MERCHANT"]).default("CUSTOMER")
  }).superRefine((value, ctx) => {
    if (value.accountType === "MERCHANT" && (!value.storeName || value.storeName.length < 2)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: t("validation.storeNameRequired"),
        path: ["storeName"]
      });
    }
  });
}

export function createOtpSchema(t: TranslationFn = defaultT) {
  return z.object({
    email: z.email(t("validation.emailInvalid")),
    otp: z.string().regex(/^\d{6}$/, t("validation.otpLength", { length: 6 }))
  });
}

export function createResetRequestSchema(t: TranslationFn = defaultT) {
  return z.object({
    email: z.email(t("validation.emailInvalid")).transform((value) => value.trim().toLowerCase())
  });
}

export function createResetConfirmSchema(t: TranslationFn = defaultT) {
  return z
    .object({
      password: createPasswordSchema(t),
      confirmPassword: z.string().min(1, t("validation.passwordRequired"))
    })
    .superRefine((value, ctx) => {
      if (value.password !== value.confirmPassword) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: t("validation.passwordMismatch"),
          path: ["confirmPassword"]
        });
      }
    });
}

export const passwordSchema = createPasswordSchema();
export const loginSchema = createLoginSchema();
export const signupSchema = createSignupSchema();
export const otpSchema = createOtpSchema();
export const resetRequestSchema = createResetRequestSchema();
export const resetConfirmSchema = createResetConfirmSchema();

function isEmail(value: string) {
  return z.email().safeParse(value.trim().toLowerCase()).success;
}

function isIndianLoginPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  const mobile = digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits;
  return /^[6-9]\d{9}$/.test(mobile);
}

export type PasswordStrength = {
  score: 0 | 1 | 2 | 3 | 4;
  label: "Very weak" | "Weak" | "Fair" | "Strong" | "Very strong";
  percent: number;
};

export function passwordStrength(password: string): PasswordStrength {
  let points = 0;
  if (password.length >= 8) points += 1;
  if (password.length >= 12) points += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) points += 1;
  if (/\d/.test(password)) points += 1;
  if (/[^A-Za-z0-9]/.test(password)) points += 1;
  if (password.length >= 16) points += 1;

  const score = Math.min(4, Math.max(0, points - 1)) as PasswordStrength["score"];
  const labels: Array<PasswordStrength["label"]> = [
    "Very weak",
    "Weak",
    "Fair",
    "Strong",
    "Very strong"
  ];
  return {
    score,
    label: labels[score],
    percent: (score + 1) * 20
  };
}

export function zodFieldErrors<TFields extends string>(
  error: z.ZodError,
  fields: readonly TFields[]
): Partial<Record<TFields, string>> {
  const fieldSet = new Set<string>(fields);
  const errors: Partial<Record<TFields, string>> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "");
    if (fieldSet.has(field) && !errors[field as TFields]) {
      errors[field as TFields] = issue.message;
    }
  }
  return errors;
}
