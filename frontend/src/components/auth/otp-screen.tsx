"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  ClipboardEvent,
  KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Link, useRouter } from "@/i18n/navigation";
import { ApiError } from "@/lib/api";
import { defaultAuthRedirect, toLocalizedBrowserPath, validateInternalRedirect } from "@/lib/auth-redirect";
import { AuthShell } from "@/components/auth/auth-shell";
import { useAuthSession } from "@/components/session-refresh-provider";
import { resendSignupOtp, verifySignup } from "@/lib/auth-api";
import { useToast } from "@/components/toast/toast-context";
import { useApiErrorTranslator } from "@/i18n/error-messages";

const OTP_DIGIT_COUNT = 6;
const emptyOtp = Array.from({ length: OTP_DIGIT_COUNT }, () => "");

function mapOtpError(error: unknown) {
  if (error instanceof DOMException && error.name === "AbortError") {
    return null;
  }
  if (error instanceof ApiError) {
    if (error.status === 401 || error.status === 403) {
      return "That code is invalid or expired. Check the code and try again.";
    }
    if (error.status === 429) {
      return "Too many attempts. Please wait a moment, then try again.";
    }
    if (error.status >= 500) {
      return "Verification is taking longer than expected. Please try again.";
    }
  }
  return "Verification failed. Please try again.";
}

function markAuthEvent(name: string) {
  if (typeof performance !== "undefined" && "mark" in performance) {
    performance.mark(name);
  }
}

function replaceWithAuthenticatedRoute(path: string) {
  window.location.replace(toLocalizedBrowserPath(path));
}

export function OtpScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations("auth");
  const translateApiError = useApiErrorTranslator();
  const { setSession } = useAuthSession();
  const { error: toastError, success: toastSuccess, warning: toastWarning } = useToast();
  const [otp, setOtp] = useState(emptyOtp);
  const [email, setEmail] = useState("");
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [, setTick] = useState(0);
  const [status, setStatus] = useState<"idle" | "verifying" | "success" | "error">("idle");
  const [resending, setResending] = useState(false);
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const abortRef = useRef<AbortController | null>(null);
  const inFlightRef = useRef(false);
  const lastAutoSubmittedOtpRef = useRef<string | null>(null);
  const redirectValidation = useMemo(
    () => validateInternalRedirect(searchParams.get("next")),
    [searchParams]
  );

  useEffect(() => {
    const nextEmail = searchParams.get("email") ?? localStorage.getItem("lotzi:pending-signup-email") ?? "";
    const pendingCooldown = localStorage.getItem("lotzi:signup-otp-cooldown-until");
    if (!nextEmail) {
      toastWarning(t("otp.missingSignup"));
      router.replace("/auth/signup");
      return;
    }
    setEmail(nextEmail.trim().toLowerCase());
    localStorage.setItem("lotzi:pending-signup-email", nextEmail.trim().toLowerCase());
    if (pendingCooldown) {
      const parsedCooldown = new Date(pendingCooldown).getTime();
      setCooldownUntil(Number.isFinite(parsedCooldown) && parsedCooldown > Date.now() ? parsedCooldown : null);
    }
    router.prefetch("/");
    // Do not prefetch protected post-auth routes before cookies are issued.
    router.prefetch("/auth/signup");
  }, [router, searchParams, t, toastWarning]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  useEffect(() => {
    if (!cooldownUntil) {
      return undefined;
    }
    const interval = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => window.clearInterval(interval);
  }, [cooldownUntil]);

  const applyOtpDigits = useCallback((value: string, startIndex = 0) => {
    const digits = value.replace(/\D/g, "").slice(0, OTP_DIGIT_COUNT - startIndex);
    if (!digits) {
      return;
    }

    setOtp((current) => {
      const next = [...current];
      digits.split("").forEach((digit, offset) => {
        next[startIndex + offset] = digit;
      });
      if (next.join("") !== current.join("")) {
        lastAutoSubmittedOtpRef.current = null;
      }
      return next;
    });
    setStatus("idle");

    const nextIndex = Math.min(startIndex + digits.length, OTP_DIGIT_COUNT - 1);
    inputRefs.current[nextIndex]?.focus();
  }, []);

  const updateOtp = (index: number, value: string) => {
    const digits = value.replace(/\D/g, "");
    if (digits.length > 1) {
      applyOtpDigits(digits, index);
      return;
    }

    setOtp((current) => {
      const next = current.map((digit, itemIndex) => (itemIndex === index ? digits : digit));
      if (next.join("") !== current.join("")) {
        lastAutoSubmittedOtpRef.current = null;
      }
      return next;
    });
    setStatus("idle");

    if (digits && index < OTP_DIGIT_COUNT - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleOtpPaste = (index: number, event: ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    applyOtpDigits(event.clipboardData.getData("text"), index);
  };

  const handleOtpKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Backspace" && !otp[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
    if (event.key === "ArrowLeft" && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
    if (event.key === "ArrowRight" && index < OTP_DIGIT_COUNT - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleVerify = useCallback(async () => {
    if (inFlightRef.current || otp.some((digit) => !digit) || !email) {
      return;
    }

    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    inFlightRef.current = true;
    setStatus("verifying");
    markAuthEvent("auth:otp:submit");
    let navigated = false;

    try {
      const session = await verifySignup({ email, otp: otp.join("") }, { signal: controller.signal });
      setSession(session);
      localStorage.removeItem("lotzi:pending-signup-email");
      localStorage.removeItem("lotzi:signup-otp-cooldown-until");
      setStatus("success");
      toastSuccess(t("otp.success"));
      navigated = true;
      markAuthEvent("auth:otp:redirect-start");
      replaceWithAuthenticatedRoute(redirectValidation.path ?? defaultAuthRedirect(session));
    } catch (apiError) {
      const message = translateApiError(apiError, "AUTH_OTP_INVALID") || mapOtpError(apiError);
      if (message) {
        setStatus("error");
        toastError(message);
      }
    } finally {
      if (!navigated) {
        inFlightRef.current = false;
        abortRef.current = null;
      }
    }
  }, [email, otp, redirectValidation.path, setSession, t, toastError, toastSuccess, translateApiError]);

  const handleResend = async () => {
    if (resending || cooldownSeconds > 0 || !email) {
      return;
    }

    const controller = new AbortController();
    setResending(true);
    try {
      const result = await resendSignupOtp({ email }, { signal: controller.signal });
      if (result.cooldownUntil) {
        setCooldownUntil(new Date(result.cooldownUntil).getTime());
        localStorage.setItem("lotzi:signup-otp-cooldown-until", result.cooldownUntil);
      }
      toastSuccess(t("otp.resendSuccess"));
    } catch (apiError) {
      const message = translateApiError(apiError, "AUTH_OTP_INVALID") || mapOtpError(apiError);
      if (message) {
        toastError(message);
      }
    } finally {
      setResending(false);
    }
  };

  const cooldownSeconds = cooldownUntil
    ? Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000))
    : 0;
  const isComplete = otp.every(Boolean);
  const isBusy = status === "verifying" || status === "success";
  const otpValue = otp.join("");

  useEffect(() => {
    if (!isComplete || !email || isBusy || lastAutoSubmittedOtpRef.current === otpValue) {
      return;
    }
    lastAutoSubmittedOtpRef.current = otpValue;
    void handleVerify();
  }, [email, handleVerify, isBusy, isComplete, otpValue]);

  return (
    <AuthShell>
      <div className="flex min-h-0 flex-1 flex-col px-7 pb-6 pt-8 sm:pb-7 sm:pt-9">
        <Link
          aria-label={t("signup.submit")}
          className="flex size-10 items-center justify-center rounded-xl bg-zinc-100 text-zinc-900 transition hover:bg-zinc-200/80 active:translate-y-px focus:outline-none focus:ring-4 focus:ring-zinc-950/5"
          href="/auth/signup"
          prefetch
        >
          <ArrowLeft size={16} strokeWidth={2.5} />
        </Link>

        <div className="mt-10 text-center sm:mt-12">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">{t("otp.title")}</h1>
          <p className="mx-auto mt-2 max-w-[275px] text-[13px] font-normal leading-relaxed text-zinc-500">
            {t("otp.description", { destination: email || t("fields.email.label") })}
          </p>
        </div>

        <fieldset className="mt-7">
          <legend className="sr-only">{t("fields.otp.label")}</legend>
          <div className="flex items-center justify-center gap-2">
          {otp.map((digit, index) => (
            <input
              aria-label={`${t("fields.otp.label")} ${index + 1}`}
              autoComplete={index === 0 ? "one-time-code" : "off"}
              className={`h-11 w-10 rounded-xl border bg-zinc-50/50 text-center text-lg font-bold text-zinc-950 outline-none transition-all focus:bg-white focus:ring-4 sm:w-11 ${
                status === "error"
                  ? "border-rose-300 focus:border-rose-500 focus:ring-rose-500/10"
                  : digit
                  ? "border-zinc-950 focus:border-zinc-950 focus:ring-zinc-950/5"
                  : "border-zinc-200 focus:border-zinc-950 focus:ring-zinc-950/5"
              }`}
              disabled={isBusy}
              inputMode="numeric"
              key={index}
              maxLength={1}
              name={index === 0 ? "one-time-code" : undefined}
              onChange={(event) => updateOtp(index, event.target.value)}
              onKeyDown={(event) => handleOtpKeyDown(index, event)}
              onPaste={(event) => handleOtpPaste(index, event)}
              pattern="[0-9]*"
              ref={(element) => {
                inputRefs.current[index] = element;
              }}
              type="text"
              value={digit}
            />
          ))}
          </div>
        </fieldset>

        <button
          className="mt-6 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-zinc-950 text-[13px] font-medium text-white shadow-sm transition-colors hover:bg-zinc-900 active:translate-y-px focus:outline-none focus:ring-4 focus:ring-zinc-950/5 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={isBusy || !isComplete || !email}
          onClick={handleVerify}
          type="button"
        >
          {status === "verifying" && <Loader2 className="animate-spin" size={14} />}
          {status === "verifying" ? t("otp.submitting") : t("otp.submit")}
        </button>

        <p className="mt-6 text-center text-[13px] font-normal text-zinc-500">
          {t("otp.resendPrompt")}{" "}
          <button
            className="inline-flex items-center gap-1 font-medium text-zinc-950 transition hover:text-zinc-700 disabled:text-zinc-400 focus:outline-none"
            disabled={resending || cooldownSeconds > 0 || !email}
            onClick={handleResend}
            type="button"
          >
            {resending && <Loader2 className="animate-spin" size={12} />}
            {cooldownSeconds > 0 ? t("otp.resendIn", { seconds: cooldownSeconds }) : t("otp.resend")}
          </button>
        </p>
      </div>
    </AuthShell>
  );
}
