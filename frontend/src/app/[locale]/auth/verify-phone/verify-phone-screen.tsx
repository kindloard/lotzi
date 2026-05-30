"use client";

import type { ClipboardEvent, KeyboardEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Link, useRouter } from "@/i18n/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { useToast } from "@/components/toast/toast-context";
import { ApiError } from "@/lib/api";
import {
  checkoutOnboardingStatus,
  sendPhoneOtp,
  verifyPhoneOtp
} from "@/lib/auth-api";
import { safeNextPath } from "@/features/checkout/address-draft";

const OTP_DIGIT_COUNT = 6;
const emptyOtp = Array.from({ length: OTP_DIGIT_COUNT }, () => "");

type GuardStatus = "checking" | "ready" | "blocked";
type VerifyStatus = "idle" | "sending" | "verifying" | "success" | "error";

export function VerifyPhoneScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();
  const flowToken = searchParams.get("flow") ?? "";
  const [guardStatus, setGuardStatus] = useState<GuardStatus>("checking");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [phoneMasked, setPhoneMasked] = useState("");
  const [nextPath, setNextPath] = useState("/cart");
  const [otpRequestId, setOtpRequestId] = useState<string | undefined>();
  const [otp, setOtp] = useState(emptyOtp);
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [resendCount, setResendCount] = useState(0);
  const [status, setStatus] = useState<VerifyStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [providerBlocked, setProviderBlocked] = useState(false);
  const [providerReference, setProviderReference] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const abortRef = useRef<AbortController | null>(null);
  const verifyInFlightRef = useRef(false);
  const initialSendStartedRef = useRef<string | null>(null);
  const lastSubmittedOtpRef = useRef<string | null>(null);
  const activeGuardRunRef = useRef(0);
  const activeFlowTokenRef = useRef<string | null>(null);
  const routerRef = useRef(router);
  const toastRef = useRef(toast);

  const backPath = useMemo(
    () => `/checkout/address/details?next=${encodeURIComponent(nextPath)}`,
    [nextPath]
  );

  const sendOtp = useCallback(
    async (mobile: string, idempotencyKey: string, mode: "initial" | "resend") => {
      setStatus("sending");
      setMessage(mode === "resend" ? "Sending a new code..." : "Sending OTP...");
      try {
        const result = await sendPhoneOtp(
          { phoneNumber: mobile, flowToken },
          idempotencyKey
        );
        setOtpRequestId(result.otpRequestId);
        setCooldownUntil(Date.now() + result.resendAfterSeconds * 1000);
        setExpiresAt(new Date(result.expiresAt).getTime());
        setProviderReference(result.providerRequestId ?? null);
        setStatus("idle");
        setMessage(null);
        setProviderBlocked(false);
        if (mode === "resend") {
          setOtp(emptyOtp);
          lastSubmittedOtpRef.current = null;
          setResendCount((value) => value + 1);
          toast.success("Verification code resent.");
          window.setTimeout(() => inputRefs.current[0]?.focus(), 0);
        }
      } catch (error) {
        setStatus("error");
        const text = phoneOtpError(error);
        setMessage(text);
        setProviderBlocked(isProviderSetupError(error));
        toast.error(text);
      }
    },
    [flowToken, toast]
  );
  const sendOtpRef = useRef(sendOtp);

  useEffect(() => {
    routerRef.current = router;
    toastRef.current = toast;
    sendOtpRef.current = sendOtp;
  });

  useEffect(() => {
    if (activeFlowTokenRef.current !== flowToken) {
      activeFlowTokenRef.current = flowToken;
      initialSendStartedRef.current = null;
      lastSubmittedOtpRef.current = null;
      verifyInFlightRef.current = false;
      setGuardStatus("checking");
      setStatus("idle");
      setMessage(null);
      setProviderBlocked(false);
      setProviderReference(null);
      setPhoneNumber("");
      setPhoneMasked("");
      setOtpRequestId(undefined);
      setOtp(emptyOtp);
      setCooldownUntil(null);
      setExpiresAt(null);
      setResendCount(0);
    }

    if (!flowToken) {
      setGuardStatus("blocked");
      toastRef.current.warning("Checkout setup expired. Review your address and continue again.");
      routerRef.current.replace("/checkout/address/details?next=%2Fcart");
      return undefined;
    }

    let cancelled = false;
    const guardRun = activeGuardRunRef.current + 1;
    activeGuardRunRef.current = guardRun;
    const controller = new AbortController();
    abortRef.current = controller;

    async function guard() {
      try {
        const flow = await checkoutOnboardingStatus(flowToken, { signal: controller.signal });
        if (cancelled || activeGuardRunRef.current !== guardRun) {
          return;
        }
        if (!flow.valid || !flow.phoneNumber) {
          setGuardStatus("blocked");
          toastRef.current.warning("Checkout setup expired. Review your address and continue again.");
          routerRef.current.replace("/checkout/address/details?next=%2Fcart");
          return;
        }
        const safeNext = safeNextPath(flow.nextPath ?? "/cart");
        setNextPath(safeNext);
        setPhoneNumber(flow.phoneNumber);
        setPhoneMasked(flow.phoneMasked ?? flow.phoneNumber);
        if (flow.phoneVerified && flow.proofValid) {
          routerRef.current.replace(`/auth/checkout-password?${new URLSearchParams({ flow: flowToken }).toString()}`);
          return;
        }
        setGuardStatus("ready");
        routerRef.current.prefetch("/auth/checkout-password");
        if (initialSendStartedRef.current !== flowToken) {
          initialSendStartedRef.current = flowToken;
          void sendOtpRef.current(flow.phoneNumber, `checkout-phone-otp:${flowToken}:initial`, "initial");
        }
      } catch (error) {
        if (
          cancelled ||
          activeGuardRunRef.current !== guardRun ||
          (error instanceof DOMException && error.name === "AbortError")
        ) {
          return;
        }
        setGuardStatus("blocked");
        setMessage(phoneOtpError(error));
      }
    }

    void guard();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [flowToken]);

  useEffect(() => {
    if (guardStatus === "ready") {
      window.setTimeout(() => inputRefs.current[0]?.focus(), 0);
    }
  }, [guardStatus]);

  useEffect(() => {
    if (!cooldownUntil && !expiresAt) {
      return undefined;
    }
    const interval = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => window.clearInterval(interval);
  }, [cooldownUntil, expiresAt]);

  useEffect(() => () => abortRef.current?.abort(), []);

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
        lastSubmittedOtpRef.current = null;
      }
      return next;
    });
    setStatus("idle");
    setMessage(null);
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
        lastSubmittedOtpRef.current = null;
      }
      return next;
    });
    setStatus("idle");
    setMessage(null);
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
    const code = otp.join("");
    if (verifyInFlightRef.current || code.length !== OTP_DIGIT_COUNT || !phoneNumber) {
      return;
    }
    verifyInFlightRef.current = true;
    setStatus("verifying");
    setMessage("Verifying OTP...");

    try {
      const result = await verifyPhoneOtp({
        flowToken,
        phoneNumber,
        otp: code,
        otpRequestId
      });
      setStatus("success");
      setMessage("Phone verified successfully.");
      toast.success("Phone verified successfully.");
      router.replace(result.passwordSetupPath);
    } catch (error) {
      verifyInFlightRef.current = false;
      setStatus("error");
      setOtp(emptyOtp);
      lastSubmittedOtpRef.current = null;
      const text = phoneOtpError(error);
      setMessage(text);
      toast.error(text);
      window.setTimeout(() => inputRefs.current[0]?.focus(), 0);
    }
  }, [flowToken, otp, otpRequestId, phoneNumber, router, toast]);

  const handleResend = () => {
    if (!phoneNumber || providerBlocked || cooldownSeconds > 0 || status === "sending") {
      return;
    }
    void sendOtp(phoneNumber, crypto.randomUUID(), "resend");
  };

  const cooldownSeconds = cooldownUntil
    ? Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000))
    : 0;
  const expirySeconds = expiresAt ? Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000)) : 0;
  const isComplete = otp.every(Boolean);
  const isBusy = status === "sending" || status === "verifying" || status === "success";
  const otpValue = otp.join("");

  useEffect(() => {
    if (!isComplete || isBusy || lastSubmittedOtpRef.current === otpValue) {
      return;
    }
    lastSubmittedOtpRef.current = otpValue;
    void handleVerify();
  }, [handleVerify, isBusy, isComplete, otpValue]);

  if (guardStatus !== "ready") {
    return (
      <AuthShell>
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-7 text-center">
          {guardStatus === "checking" ? <Loader2 className="size-5 animate-spin text-zinc-950" /> : null}
          <p className="mt-3 text-[13px] font-medium text-zinc-500">
            {guardStatus === "blocked" ? message ?? "Checkout verification is unavailable." : "Preparing phone verification..."}
          </p>
          {guardStatus === "blocked" ? (
            <Link
              className="mt-5 flex h-10 items-center justify-center rounded-xl bg-zinc-950 px-5 text-[13px] font-medium text-white shadow-sm transition hover:bg-zinc-900 focus:outline-none focus:ring-4 focus:ring-zinc-950/5"
              href={backPath}
            >
              Back to address
            </Link>
          ) : null}
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <div className="flex min-h-0 flex-1 flex-col px-7 pb-6 pt-8 sm:pb-7 sm:pt-9">
        <Link
          aria-label="Back to address"
          className="flex size-10 items-center justify-center rounded-xl bg-zinc-100 text-zinc-900 transition hover:bg-zinc-200/80 active:translate-y-px focus:outline-none focus:ring-4 focus:ring-zinc-950/5"
          href={backPath}
          prefetch
        >
          <ArrowLeft size={16} strokeWidth={2.5} />
        </Link>

        <div className="mt-10 text-center sm:mt-12">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">Verify your phone number</h1>
          <p className="mx-auto mt-2 max-w-[292px] text-[13px] font-normal leading-relaxed text-zinc-500">
            We sent a verification code to {phoneMasked}.
          </p>
        </div>

        <fieldset className="mt-7">
          <legend className="sr-only">Six digit verification code</legend>
          <div className="flex items-center justify-center gap-2">
            {otp.map((digit, index) => (
              <input
                aria-label={`Verification code digit ${index + 1}`}
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
          disabled={isBusy || !isComplete || !phoneNumber}
          onClick={handleVerify}
          type="button"
        >
          {(status === "sending" || status === "verifying") && <Loader2 className="animate-spin" size={14} />}
          {status === "sending" ? "Sending OTP..." : status === "verifying" ? "Verifying OTP..." : "Verify & Continue"}
        </button>

        <div className="mt-5 text-center text-[13px] font-normal text-zinc-500">
          <p aria-live="polite">
            {expirySeconds > 0 ? `Code expires in ${formatSeconds(expirySeconds)}.` : "Request a new code to continue."}
          </p>
          <button
            className="mt-2 inline-flex items-center gap-1 font-medium text-zinc-950 transition hover:text-zinc-700 disabled:text-zinc-400 focus:outline-none"
            disabled={status === "sending" || providerBlocked || cooldownSeconds > 0 || !phoneNumber}
            onClick={handleResend}
            type="button"
          >
            {status === "sending" && <Loader2 className="animate-spin" size={12} />}
            {cooldownSeconds > 0 ? `Resend in ${formatSeconds(cooldownSeconds)}` : "Resend Code"}
          </button>
        </div>

        {message ? (
          <p
            className={`mt-4 rounded-xl px-3 py-2 text-center text-[12px] font-medium ${
              status === "error" ? "bg-rose-50 text-rose-700" : "bg-zinc-100 text-zinc-600"
            }`}
            role={status === "error" ? "alert" : "status"}
          >
            {message}
          </p>
        ) : null}

        {providerReference ? (
          <p className="mt-3 text-center text-[11px] leading-4 text-zinc-400" aria-live="polite">
            SMS accepted by Fast2SMS. Ref: {providerReference}.
          </p>
        ) : null}

        {resendCount >= 2 ? (
          <p className="mt-3 text-center text-[12px] leading-5 text-zinc-500">
            SMS can be delayed by carrier filtering or DND settings. Wait a moment before requesting another code.
          </p>
        ) : null}
      </div>
    </AuthShell>
  );
}

function formatSeconds(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function phoneOtpError(error: unknown) {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "Request was cancelled.";
  }
  if (error instanceof ApiError) {
    const code = apiErrorCode(error.body);
    if (code === "PHONE_OTP_EXPIRED") {
      return "The verification code expired. Request a new code.";
    }
    if (code === "PHONE_OTP_BLOCKED" || error.status === 429) {
      return "Too many attempts. Please wait before trying again.";
    }
    if (code === "PHONE_OTP_SEND_ALREADY_FAILED") {
      return "That send attempt already failed. Request a new code to continue.";
    }
    if (code === "OTP_PROVIDER_TIMEOUT" || code === "OTP_PROVIDER_UNAVAILABLE") {
      return "SMS delivery is taking longer than expected. Please try again shortly.";
    }
    if (
      code === "OTP_PROVIDER_ACCOUNT_NOT_READY" ||
      code === "OTP_PROVIDER_AUTH_FAILED" ||
      code === "OTP_PROVIDER_BALANCE_LOW" ||
      code === "OTP_PROVIDER_TEMPLATE_INVALID"
    ) {
      return "SMS verification is not enabled yet. Please contact support to finish phone verification.";
    }
    if (error.status === 401 || error.status === 403) {
      return "That code is invalid. Check the SMS and try again.";
    }
    return error.message || "Phone verification failed. Please try again.";
  }
  return error instanceof Error ? error.message : "Phone verification failed. Please try again.";
}

function isProviderSetupError(error: unknown) {
  if (!(error instanceof ApiError)) {
    return false;
  }
  const code = apiErrorCode(error.body);
  return (
    code === "OTP_PROVIDER_ACCOUNT_NOT_READY" ||
    code === "OTP_PROVIDER_AUTH_FAILED" ||
    code === "OTP_PROVIDER_BALANCE_LOW" ||
    code === "OTP_PROVIDER_TEMPLATE_INVALID"
  );
}

function apiErrorCode(body: unknown) {
  if (body && typeof body === "object" && "code" in body) {
    const code = (body as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}
