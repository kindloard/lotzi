"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import { ZodError, z } from "zod";
import { Link, useRouter } from "@/i18n/navigation";
import { AuthInput } from "@/components/auth/auth-input";
import { AuthShell } from "@/components/auth/auth-shell";
import { AuthSubmitButton } from "@/components/auth/auth-submit-button";
import { useAuthSession } from "@/components/session-refresh-provider";
import { useToast } from "@/components/toast/toast-context";
import { clearAddressDraft, safeNextPath } from "@/features/checkout/address-draft";
import { ApiError } from "@/lib/api";
import { checkoutOnboardingStatus, phoneSignup } from "@/lib/auth-api";
import {
  createPasswordSchema,
  passwordStrength,
  zodFieldErrors
} from "@/lib/auth-schemas";

type FieldName = "password" | "confirmPassword";
type FieldErrors = Partial<Record<FieldName, string>>;
type TouchedFields = Partial<Record<FieldName, boolean>>;
type FormStatus = "idle" | "submitting" | "success" | "error";

const checkoutPasswordSchema = z
  .object({
    password: createPasswordSchema(),
    confirmPassword: z.string().min(1, "Confirm your password.")
  })
  .superRefine((value, ctx) => {
    if (value.password !== value.confirmPassword) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Passwords do not match.",
        path: ["confirmPassword"]
      });
    }
  });

export function CheckoutPasswordScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();
  const { session, setSession } = useAuthSession();
  const flowToken = searchParams.get("flow") ?? "";
  const [guardStatus, setGuardStatus] = useState<"checking" | "ready" | "blocked">("checking");
  const [phoneMasked, setPhoneMasked] = useState("");
  const [nextPath, setNextPath] = useState("/cart");
  const [values, setValues] = useState({ password: "", confirmPassword: "" });
  const [touched, setTouched] = useState<TouchedFields>({});
  const [status, setStatus] = useState<FormStatus>("idle");
  const inFlightRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const fieldErrors = useMemo(() => validate(values), [values]);
  const isValid = !fieldErrors.password && !fieldErrors.confirmPassword;
  const strength = useMemo(() => passwordStrength(values.password), [values.password]);

  useEffect(() => {
    if (!flowToken) {
      setGuardStatus("blocked");
      toast.warning("Phone verification is required before password setup.");
      router.replace("/checkout/address/details?next=%2Fcart");
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    abortRef.current = controller;

    async function guard() {
      try {
        const flow = await checkoutOnboardingStatus(flowToken, { signal: controller.signal });
        if (cancelled) {
          return;
        }
        const safeNext = safeNextPath(flow.nextPath ?? "/cart");
        setNextPath(safeNext);
        if (session) {
          router.replace(safeNext);
          return;
        }
        if (!flow.valid || !flow.phoneVerified || !flow.proofValid) {
          setGuardStatus("blocked");
          toast.warning("Verify your phone number before creating a password.");
          router.replace(`/auth/verify-phone?${new URLSearchParams({ flow: flowToken }).toString()}`);
          return;
        }
        setPhoneMasked(flow.phoneMasked ?? "your phone");
        setGuardStatus("ready");
        router.prefetch(safeNext);
      } catch (error) {
        if (cancelled || (error instanceof DOMException && error.name === "AbortError")) {
          return;
        }
        setGuardStatus("blocked");
        toast.error(checkoutPasswordError(error));
        router.replace(`/auth/verify-phone?${new URLSearchParams({ flow: flowToken }).toString()}`);
      }
    }

    void guard();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [flowToken, router, session, toast]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const updateField = (name: string, value: string) => {
    setValues((current) => ({ ...current, [name]: value }));
    if (status === "error") {
      setStatus("idle");
    }
  };

  const touchField = (name: string) => {
    setTouched((current) => ({ ...current, [name]: true }));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (inFlightRef.current || guardStatus !== "ready") {
      return;
    }

    setTouched({ password: true, confirmPassword: true });
    const parsed = checkoutPasswordSchema.safeParse(values);
    if (!parsed.success) {
      setStatus("error");
      toast.warning("Fix the highlighted fields to continue.");
      return;
    }

    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    inFlightRef.current = true;
    setStatus("submitting");

    try {
      const createdSession = await phoneSignup(
        { flowToken, password: parsed.data.password },
        { signal: controller.signal }
      );
      setSession(createdSession);
      clearAddressDraft();
      setStatus("success");
      toast.success("Account created.");
      router.replace(nextPath);
    } catch (error) {
      inFlightRef.current = false;
      abortRef.current = null;
      setStatus("error");
      toast.error(checkoutPasswordError(error));
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        router.replace(`/auth/verify-phone?${new URLSearchParams({ flow: flowToken }).toString()}`);
      }
    }
  };

  if (guardStatus !== "ready") {
    return (
      <AuthShell>
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-7 text-center">
          <Loader2 className="size-5 animate-spin text-zinc-950" />
          <p className="mt-3 text-[13px] font-medium text-zinc-500">
            {guardStatus === "blocked" ? "Returning to verification..." : "Checking secure checkout..."}
          </p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <div className="flex min-h-0 flex-1 flex-col px-7 pb-6 pt-8 sm:pb-7 sm:pt-9">
        <Link
          aria-label="Back to phone verification"
          className="flex size-10 items-center justify-center rounded-xl bg-zinc-100 text-zinc-900 transition hover:bg-zinc-200/80 active:translate-y-px focus:outline-none focus:ring-4 focus:ring-zinc-950/5"
          href={`/auth/verify-phone?${new URLSearchParams({ flow: flowToken }).toString()}`}
          prefetch
        >
          <ArrowLeft size={16} strokeWidth={2.5} />
        </Link>

        <div className="mt-10 text-center sm:mt-12">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">Create your password</h1>
          <p className="mx-auto mt-2 max-w-[295px] text-[13px] font-normal leading-relaxed text-zinc-500">
            Your phone {phoneMasked} is verified. Set a password to finish checkout.
          </p>
        </div>

        <form className="mt-7 flex flex-col" noValidate onSubmit={submit}>
          <fieldset className="space-y-3.5" disabled={status === "submitting" || status === "success"}>
            <AuthInput
              autoComplete="new-password"
              error={fieldErrors.password}
              label="New password"
              name="password"
              onBlur={touchField}
              onChange={updateField}
              placeholder="Create a strong password"
              required
              strength={strength}
              touched={touched.password}
              type="password"
              value={values.password}
            />
            <AuthInput
              autoComplete="new-password"
              error={fieldErrors.confirmPassword}
              label="Confirm password"
              name="confirmPassword"
              onBlur={touchField}
              onChange={updateField}
              placeholder="Re-enter your password"
              required
              touched={touched.confirmPassword}
              type="password"
              value={values.confirmPassword}
            />
          </fieldset>

          <AuthSubmitButton
            disabled={!isValid || status === "submitting" || status === "success"}
            label="Create account"
            loading={status === "submitting"}
            loadingLabel="Creating account..."
            status={status === "success" ? "success" : status === "error" ? "error" : "default"}
          />
        </form>
      </div>
    </AuthShell>
  );
}

function validate(values: { password: string; confirmPassword: string }): FieldErrors {
  const result = checkoutPasswordSchema.safeParse(values);
  return result.success
    ? {}
    : zodFieldErrors(result.error as ZodError, ["password", "confirmPassword"]);
}

function checkoutPasswordError(error: unknown) {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "Setup was cancelled.";
  }
  if (error instanceof ApiError) {
    if (error.status === 409) {
      const code = (error.body as { code?: unknown } | undefined)?.code;
      if (code === "EMAIL_ALREADY_REGISTERED") {
        return "This email already has an account. Sign in to continue checkout.";
      }
      return "This phone number already has an account. Sign in to continue checkout.";
    }
    if (error.status === 401 || error.status === 403) {
      return "Phone verification expired. Verify your phone again.";
    }
    if (error.status === 429) {
      return "Too many attempts. Please wait a moment, then try again.";
    }
    if (error.status >= 500 || error.status === 0) {
      return "Account setup is temporarily unavailable. Please try again.";
    }
    return error.message || "Account setup failed. Please try again.";
  }
  return error instanceof Error ? error.message : "Account setup failed. Please try again.";
}
