"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import {
  FormEvent,
  MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { ArrowLeft, ArrowRight, Check, Loader2, Store } from "lucide-react";
import { ZodError } from "zod";
import { ApiError } from "@/lib/api";
import { googleLogin, login, reportRejectedRedirect, signup } from "@/lib/auth-api";
import { defaultAuthRedirect, toLocalizedBrowserPath, validateInternalRedirect } from "@/lib/auth-redirect";
import { createLoginSchema, createSignupSchema, passwordStrength, zodFieldErrors } from "@/lib/auth-schemas";
import { useAuthSession } from "@/components/session-refresh-provider";
import { AuthInput } from "@/components/auth/auth-input";
import { AuthShell } from "@/components/auth/auth-shell";
import { AuthSubmitButton } from "@/components/auth/auth-submit-button";
import { GoogleSignInButton } from "@/components/auth/google-sign-in-button";
import { useToast } from "@/components/toast/toast-context";
import { useApiErrorTranslator } from "@/i18n/error-messages";

type CredentialMode = "login" | "signup" | "merchant-signup";
type FormStatus = "idle" | "editing" | "submitting" | "success" | "error";
type FieldName = "name" | "storeName" | "email" | "password";

interface CredentialAuthScreenProps {
  mode: CredentialMode;
}

interface CredentialValues {
  name: string;
  storeName: string;
  email: string;
  password: string;
}

type FieldErrors = Partial<Record<FieldName, string>>;
type TouchedFields = Partial<Record<FieldName, boolean>>;

const initialValues: CredentialValues = {
  name: "",
  storeName: "",
  email: "",
  password: ""
};

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function requiredFields(mode: CredentialMode): FieldName[] {
  if (mode === "login") {
    return ["email", "password"];
  }
  if (mode === "merchant-signup") {
    return ["name", "storeName", "email", "password"];
  }
  return ["name", "email", "password"];
}

function validate(values: CredentialValues, mode: CredentialMode, t: (key: string, values?: Record<string, number | string>) => string): FieldErrors {
  const result =
    mode === "login"
      ? createLoginSchema(t).safeParse({
          email: values.email,
          password: values.password,
          remember: true
        })
      : createSignupSchema(t).safeParse({
          name: values.name,
          storeName: values.storeName,
          email: values.email,
          password: values.password,
          accountType: mode === "merchant-signup" ? "MERCHANT" : "CUSTOMER"
        });

  return result.success
    ? {}
    : zodFieldErrors(result.error as ZodError, ["name", "storeName", "email", "password"]);
}

type ApiErrorTranslator = ReturnType<typeof useApiErrorTranslator>;

function mapAuthError(error: unknown, mode: CredentialMode) {
  if (error instanceof DOMException && error.name === "AbortError") {
    return null;
  }

  if (error instanceof ApiError) {
    if (error.status === 401 || error.status === 403) {
      return mode === "login"
        ? "Email, phone, or password is incorrect."
        : "We could not complete that request. Check the details and try again.";
    }

    if (error.status === 409) {
      if (
        error.body &&
        typeof error.body === "object" &&
        "code" in error.body &&
        error.body.code === "LINK_REQUIRED"
      ) {
        return "This email already uses password sign-in. Sign in first, then link Google from your profile.";
      }
      return "That email may already be registered. Try signing in instead.";
    }

    if (error.status === 429) {
      return "Too many attempts. Please wait a moment, then try again.";
    }

    if (error.status >= 500) {
      if (process.env.NODE_ENV === "development") {
        return "The auth service hit a server error. Check the backend logs, then try again.";
      }
      return "The auth service is temporarily unavailable. Please try again.";
    }

    if (error.status === 0) {
      return "The backend API is not reachable. Start the backend on port 4000, then try again.";
    }
  }

  return error instanceof Error ? error.message : "Authentication failed. Please try again.";
}

function credentialErrorMessage(
  error: unknown,
  mode: CredentialMode,
  translateApiError: ApiErrorTranslator
) {
  if (error instanceof DOMException && error.name === "AbortError") {
    return null;
  }

  if (error instanceof ApiError) {
    if (mode === "login" && isInvalidCredentialError(error)) {
      return translateApiError(error, "AUTH_INVALID_CREDENTIALS");
    }
    if (error.status === 0 || error.status >= 500) {
      return mapAuthError(error, mode);
    }
    return translateApiError(error, "GENERIC") || mapAuthError(error, mode);
  }

  return mapAuthError(error, mode);
}

function isInvalidCredentialError(error: ApiError) {
  const code = apiErrorCode(error.body);
  return (
    error.status === 401 &&
    (code === "AUTH_INVALID_CREDENTIALS" || code === "UNAUTHORIZED" || code === undefined)
  );
}

function apiErrorCode(body: unknown) {
  if (body && typeof body === "object" && "code" in body) {
    const code = (body as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

function Divider() {
  const t = useTranslations("auth.shared");
  return (
    <div className="my-4 grid w-full grid-cols-[1fr_auto_1fr] items-center gap-4">
      <span className="h-px bg-zinc-200" />
      <span className="text-[10px] font-semibold text-zinc-400">{t("or")}</span>
      <span className="h-px bg-zinc-200" />
    </div>
  );
}

function markAuthEvent(name: string) {
  if (typeof performance !== "undefined" && "mark" in performance) {
    performance.mark(name);
  }
}

function replaceWithAuthenticatedRoute(path: string) {
  window.location.replace(toLocalizedBrowserPath(path));
}

function RememberControl({
  checked,
  disabled,
  label,
  onChange
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  onChange: () => void;
}) {
  return (
    <button
      aria-pressed={checked}
      className="inline-flex items-center gap-2 text-left text-[13px] font-medium text-zinc-700 transition disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none"
      disabled={disabled}
      onClick={onChange}
      type="button"
    >
      <span
        className={`flex size-4 items-center justify-center rounded-[5px] transition-all ${
          checked ? "bg-zinc-950 text-white shadow-sm" : "border border-zinc-300 bg-white text-transparent"
        }`}
      >
        <Check size={10} strokeWidth={3} />
      </span>
      {label}
    </button>
  );
}

function MerchantSignupCard({ disabled }: { disabled: boolean }) {
  const router = useRouter();
  const t = useTranslations("auth.shared");
  const [pending, setPending] = useState(false);

  const warmRoute = useCallback(() => {
    router.prefetch("/auth/merchant/signup");
  }, [router]);

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (disabled || pending) {
      event.preventDefault();
      return;
    }
    setPending(true);
    warmRoute();
  };

  useEffect(() => {
    warmRoute();
  }, [warmRoute]);

  return (
    <Link
      aria-disabled={disabled || pending}
      className={`group relative mt-3 flex h-11 w-full items-center justify-center rounded-xl border border-zinc-200 bg-zinc-50/50 text-left transition-all hover:border-zinc-300 hover:bg-white focus:outline-none focus:ring-4 focus:ring-zinc-950/5 ${
        disabled || pending ? "pointer-events-none opacity-70" : ""
      }`}
      href="/auth/merchant/signup"
      onClick={handleClick}
      onFocus={warmRoute}
      onPointerEnter={warmRoute}
      prefetch
    >
      <span className="grid grid-cols-[24px_180px] items-center gap-2">
        <span className="flex size-6 items-center justify-center justify-self-center text-zinc-950">
          <Store size={16} strokeWidth={2} />
        </span>
        <span className="min-w-0 text-left text-[13px] font-semibold leading-5 text-zinc-950 underline-offset-4 group-hover:underline">
          {t("shopOwner")}
        </span>
      </span>
      <span className="absolute right-4 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-full bg-white text-zinc-800 border border-zinc-200 transition-all group-hover:bg-zinc-950 group-hover:text-white group-hover:border-zinc-950">
        {pending ? <Loader2 className="animate-spin" size={12} /> : <ArrowRight size={12} strokeWidth={2} />}
      </span>
    </Link>
  );
}

export function CredentialAuthScreen({ mode }: CredentialAuthScreenProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations("auth");
  const schemaT = useCallback(
    (key: string, values?: Record<string, number | string>) => t(key as never, values as never),
    [t]
  );
  const translateApiError = useApiErrorTranslator();
  const { session: currentSession, setSession } = useAuthSession();
  const toast = useToast();
  const [values, setValues] = useState(initialValues);
  const [touched, setTouched] = useState<TouchedFields>({});
  const [status, setStatus] = useState<FormStatus>("idle");
  const [remember, setRemember] = useState(true);
  const [googleLoading, setGoogleLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const inFlightRef = useRef(false);
  const isSignup = mode === "signup";
  const isMerchantSignup = mode === "merchant-signup";
  const isRegistration = isSignup || isMerchantSignup;
  const isBusy = status === "submitting" || status === "success" || googleLoading;
  const fieldErrors = useMemo(() => validate(values, mode, schemaT), [values, mode, schemaT]);
  const isValid = requiredFields(mode).every((field) => !fieldErrors[field]);
  const passwordStrengthValue = useMemo(() => passwordStrength(values.password), [values.password]);
  const rawNext = searchParams.get("next");
  const redirectValidation = useMemo(() => validateInternalRedirect(rawNext), [rawNext]);
  const reportedRedirectRef = useRef<string | null>(null);

  useEffect(() => {
    const routes = isRegistration
      ? ["/auth/otp", "/auth/login", "/"]
      : ["/", "/auth/reset-password"];
    // Protected routes must not be prefetched while logged out. In production, Next can
    // reuse the unauthenticated middleware redirect after login.
    const warmRoutes = () => routes.forEach((route) => router.prefetch(route));
    const idleWindow = window as unknown as {
      requestIdleCallback?: (callback: () => void) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    const idleId = idleWindow.requestIdleCallback
      ? idleWindow.requestIdleCallback(warmRoutes)
      : window.setTimeout(warmRoutes, 250);

    return () => {
      abortRef.current?.abort();
      if (idleWindow.cancelIdleCallback && idleWindow.requestIdleCallback) {
        idleWindow.cancelIdleCallback(idleId);
      } else {
        window.clearTimeout(idleId);
      }
    };
  }, [isRegistration, router]);

  useEffect(() => {
    if (!rawNext || !redirectValidation.reason || reportedRedirectRef.current === rawNext) {
      return;
    }
    reportedRedirectRef.current = rawNext;
    void reportRejectedRedirect({
      value: rawNext,
      reason: redirectValidation.reason,
      sessionId: currentSession?.sessionId
    }).catch(() => undefined);
  }, [currentSession?.sessionId, rawNext, redirectValidation.reason]);

  const updateField = (name: string, value: string) => {
    setValues((current) => ({ ...current, [name]: value }));
    if (status === "error") {
      setStatus("editing");
    }
  };

  const touchField = (name: string) => {
    setTouched((current) => ({ ...current, [name]: true }));
  };

  const touchRequiredFields = () => {
    const nextTouched = requiredFields(mode).reduce<TouchedFields>((next, field) => {
      next[field] = true;
      return next;
    }, {});
    setTouched((current) => ({ ...current, ...nextTouched }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (inFlightRef.current) {
      return;
    }

    touchRequiredFields();
    if (!isValid) {
      setStatus("error");
      toast.warning(t("toast.validationFailed"));
      return;
    }

    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    inFlightRef.current = true;
    setStatus("submitting");
    markAuthEvent(`auth:${mode}:submit`);
    let navigated = false;

    try {
      const email = normalizeEmail(values.email);
      if (isRegistration) {
        await signup(
          {
            name: values.name.trim(),
            email,
            password: values.password,
            accountType: isMerchantSignup ? "MERCHANT" : "CUSTOMER",
            storeName: isMerchantSignup ? values.storeName.trim() : undefined
          },
          { signal: controller.signal }
        );
        localStorage.setItem("namastore:pending-signup-email", email);
        setStatus("success");
        toast.success(isMerchantSignup ? t("merchantSignup.success") : t("signup.success"));
        navigated = true;
        markAuthEvent(`auth:${mode}:redirect-start`);
        router.replace(`/auth/otp?email=${encodeURIComponent(email)}`);
        return;
      }

      const session = await login(
        { email, password: values.password, remember },
        { signal: controller.signal }
      );
      setSession(session);
      setStatus("success");
      toast.success(t("login.success"));
      navigated = true;
      markAuthEvent("auth:login:redirect-start");
      replaceWithAuthenticatedRoute(redirectValidation.path ?? defaultAuthRedirect(session));
    } catch (error) {
      const message = credentialErrorMessage(error, mode, translateApiError);
      if (!message) {
        return;
      }
      setStatus("error");
      toast.error(message);
    } finally {
      if (!navigated) {
        inFlightRef.current = false;
        abortRef.current = null;
      }
    }
  };

  const handleGoogle = async () => {
    if (isMerchantSignup || inFlightRef.current || googleLoading) {
      return;
    }

    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    inFlightRef.current = true;
    setGoogleLoading(true);
    setStatus("submitting");
    markAuthEvent("auth:google:submit");
    let navigated = false;

    try {
      const { signInWithGoogle } = await import("@/lib/google-auth-client");
      const idToken = await signInWithGoogle();
      const session = await googleLogin(idToken, { signal: controller.signal });
      setSession(session);
      setStatus("success");
      toast.success(t("toast.googleSuccess"));
      navigated = true;
      markAuthEvent("auth:google:redirect-start");
      replaceWithAuthenticatedRoute(redirectValidation.path ?? defaultAuthRedirect(session));
    } catch (error) {
      const message = credentialErrorMessage(error, mode, translateApiError);
      if (
        error instanceof ApiError &&
        error.status === 409 &&
        error.body &&
        typeof error.body === "object" &&
        "code" in error.body &&
        error.body.code === "LINK_REQUIRED"
      ) {
        const { signOutGoogle } = await import("@/lib/google-auth-client");
        await signOutGoogle();
      }

      if (message) {
        setStatus("error");
        toast.error(message);
      }
    } finally {
      if (!navigated) {
        setGoogleLoading(false);
        inFlightRef.current = false;
        abortRef.current = null;
      }
    }
  };

  const title = isMerchantSignup ? t("merchantSignup.title") : isSignup ? t("signup.title") : t("login.title");
  const description = isMerchantSignup
    ? t("merchantSignup.description")
    : isSignup
    ? t("signup.description")
    : t("login.description");
  const submitLabel = isMerchantSignup ? t("merchantSignup.submit") : isSignup ? t("signup.submit") : t("login.submit");
  const loadingLabel = isRegistration ? t("signup.submitting") : t("login.submitting");

  return (
    <AuthShell>
      <div className="flex min-h-0 flex-1 flex-col px-7 pb-6 sm:pb-7">
        <Link
          aria-label="Back to dashboard"
          className="absolute left-6 top-6 z-10 flex size-10 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-900 shadow-sm transition hover:bg-zinc-50 hover:shadow active:translate-y-px focus:outline-none focus:ring-4 focus:ring-zinc-950/5 sm:left-8 sm:top-8"
          href="/"
          prefetch
        >
          <ArrowLeft size={18} strokeWidth={2.5} />
        </Link>

        <div className="flex flex-1 flex-col justify-center py-6">
          <div className="text-center">
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">
              {title}
            </h1>
            <p className="mx-auto mt-2 max-w-[275px] text-[13px] font-normal leading-relaxed text-zinc-500">
              {description}
            </p>
          </div>

          <form className="mt-7 flex flex-col" noValidate onSubmit={handleSubmit}>
            <fieldset className="space-y-3.5" disabled={isBusy}>
              {isRegistration && (
                <AuthInput
                  autoComplete="name"
                  error={fieldErrors.name}
                  label={t("fields.name.label")}
                  name="name"
                  onBlur={touchField}
                  onChange={updateField}
                  placeholder={t("fields.name.placeholder")}
                  required
                  touched={touched.name}
                  value={values.name}
                />
              )}
              {isMerchantSignup && (
                <AuthInput
                  autoComplete="organization"
                  error={fieldErrors.storeName}
                  label={t("fields.storeName.label")}
                  name="storeName"
                  onBlur={touchField}
                  onChange={updateField}
                  placeholder={t("fields.storeName.placeholder")}
                  required
                  touched={touched.storeName}
                  value={values.storeName}
                />
              )}
              <AuthInput
                autoComplete={isRegistration ? "email" : "username"}
                error={fieldErrors.email}
                label={isRegistration ? t("fields.email.label") : t("fields.loginIdentifier.label")}
                name="email"
                onBlur={touchField}
                onChange={updateField}
                placeholder={isRegistration ? t("fields.email.placeholder") : t("fields.loginIdentifier.placeholder")}
                required
                touched={touched.email}
                type={isRegistration ? "email" : "text"}
                value={values.email}
              />
              <AuthInput
                autoComplete={isRegistration ? "new-password" : "current-password"}
                error={fieldErrors.password}
                label={t("fields.password.label")}
                name="password"
                onBlur={touchField}
                onChange={updateField}
                placeholder={t("fields.password.placeholder")}
                required
                touched={touched.password}
                type="password"
                value={values.password}
                strength={isRegistration ? passwordStrengthValue : undefined}
              />
            </fieldset>

            <div className="mt-3.5 flex items-center justify-between gap-3">
              <RememberControl
                checked={remember}
                disabled={isBusy}
                label={t("shared.rememberMe")}
                onChange={() => setRemember((current) => !current)}
              />
              {!isRegistration && (
                <Link
                  className="text-[13px] font-medium text-zinc-500 transition hover:text-zinc-950 hover:underline focus:outline-none"
                  href="/auth/reset-password"
                  prefetch
                >
                  {t("login.forgotPassword")}
                </Link>
              )}
            </div>

            <AuthSubmitButton
              disabled={!isValid || isBusy}
              label={submitLabel}
              loading={status === "submitting" && !googleLoading}
              loadingLabel={loadingLabel}
              status={status === "success" ? "success" : status === "error" ? "error" : "default"}
            />

            {!isMerchantSignup && (
              <>
                <Divider />

                <div>
                  <GoogleSignInButton
                    disabled={isBusy}
                    label={t("shared.google")}
                    loadingLabel={t("shared.googleLoading")}
                    loading={googleLoading}
                    onClick={handleGoogle}
                  />
                  {isSignup && <MerchantSignupCard disabled={isBusy} />}
                </div>
              </>
            )}
          </form>
        </div>

        <p className="pb-1 text-center text-[13px] font-normal text-zinc-500">
          {isRegistration ? t("signup.haveAccount") : t("login.noAccount")}{" "}
          <Link
            className="font-medium text-zinc-950 transition hover:text-zinc-700 focus:outline-none"
            href={isRegistration ? "/auth/login" : "/auth/signup"}
            prefetch
          >
            {isRegistration ? t("login.submit") : t("signup.submit")}
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}
