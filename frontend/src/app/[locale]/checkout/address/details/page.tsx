"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { FormEvent, InputHTMLAttributes, ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Link, useRouter } from "@/i18n/navigation";
import { useAuthSession } from "@/components/session-refresh-provider";
import { useToast } from "@/components/toast/toast-context";
import { createCustomerAddress } from "@/features/customer-account/customer-account-api";
import {
  type AddressDraft,
  clearAddressDraft,
  emptyAddressDraft,
  normalizeCoordinate,
  persistAddressDraft,
  persistSelectedAddress,
  readAddressDraft,
  safeNextPath
} from "@/features/checkout/address-draft";
import { ApiError } from "@/lib/api";
import { startCheckoutOnboarding } from "@/lib/auth-api";
import { useCart } from "@/lib/cart-context";
import { formatIndianPhoneNumber, isValidIndianPhoneNumber } from "@/features/customer-account/lib/account-utils";

type AddressFormErrorKey = "email" | "recipientName" | "recipientPhone" | "line1" | "city" | "state" | "pincode";
type AddressFormErrors = Partial<Record<AddressFormErrorKey, string>>;

export default function CheckoutAddressDetailsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();
  const { cartItemCount } = useCart();
  const { isSessionReady, session } = useAuthSession();
  const pageStartedAtRef = useRef(checkoutPerfNow());
  const nextPath = safeNextPath(searchParams.get("next"));
  const mapPath = useMemo(
    () => `/checkout/address?next=${encodeURIComponent(nextPath)}`,
    [nextPath]
  );
  const checkoutStartKeyRef = useRef<string | null>(null);

  const [draft, setDraft] = useState<AddressDraft>(() => emptyAddressDraft());
  const [draftHydrated, setDraftHydrated] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<AddressFormErrors>({});
  const [formSaving, setFormSaving] = useState(false);
  const cartItemLabel = `${cartItemCount} cart ${cartItemCount === 1 ? "item" : "items"}`;
  const isAuthResolving = !isSessionReady;

  useEffect(() => {
    const savedDraft = readAddressDraft();
    if (savedDraft) {
      setDraft((current) => ({ ...current, ...savedDraft }));
    }
    setDraftHydrated(true);
    logCheckoutPerf("Draft Hydration", pageStartedAtRef.current);
  }, []);

  useEffect(() => {
    logCheckoutPerf("Address Page Render", pageStartedAtRef.current);
  }, []);

  useEffect(() => {
    if (!isSessionReady) {
      return;
    }
    logCheckoutPerf("Session Validation", pageStartedAtRef.current, {
      source: session ? "authenticated" : "guest"
    });
  }, [isSessionReady, session]);

  useEffect(() => {
    if (!draftHydrated) {
      return;
    }
    persistAddressDraft(draft);
  }, [draft, draftHydrated]);

  function setDraftValue(key: keyof AddressDraft, value: string | boolean | number | undefined) {
    setDraft((current) => ({ ...current, [key]: value }));
    if (isAddressFormErrorKey(key)) {
      setFieldErrors((current) => clearFieldError(current, key));
    }
  }

  function validateField(key: AddressFormErrorKey) {
    setFieldErrors((current) => {
      const next = { ...current };
      const message = validateAddressField(key, draft);
      if (message) {
        next[key] = message;
      } else {
        delete next[key];
      }
      return next;
    });
  }

  const saveNormalizedAddress = useCallback(
    async (normalizedDraft: AddressDraft) => {
      setFormSaving(true);
      try {
        const addressInput = addressOnlyInput(normalizedDraft);
        const response = await createCustomerAddress({
          ...addressInput,
          isDefault: true,
          label: normalizedDraft.label?.trim() || "Home"
        });
        persistSelectedAddress(response.address.id);
        clearAddressDraft();
        toast.success("Delivery address saved.");
        router.replace(nextPath);
      } catch (error) {
        toast.error(errorMessage(error, "Address could not be saved."));
      } finally {
        setFormSaving(false);
      }
    },
    [nextPath, router, toast]
  );

  async function saveAddress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isSessionReady) {
      toast.error("Still checking your secure session. Please try again in a moment.");
      return;
    }

    const normalizedDraft = normalizeAddressDraft(draft);
    const errors = validateAddressDraft(normalizedDraft, !session);
    if (Object.keys(errors).length > 0) {
      setDraft(normalizedDraft);
      setFieldErrors(errors);
      toast.error("Please fix the highlighted address details.");
      queueMicrotask(() => {
        document.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus();
      });
      return;
    }

    if (!session) {
      persistAddressDraft(normalizedDraft);
      setFormSaving(true);
      checkoutStartKeyRef.current ??= crypto.randomUUID();
      try {
        const flow = await startCheckoutOnboarding(
          {
            ...normalizedDraft,
            email: normalizedDraft.email ?? "",
            recipientPhone: normalizedDraft.recipientPhone ?? "",
            nextPath
          },
          checkoutStartKeyRef.current
        );
        router.push(flow.verifyPhonePath);
      } catch (error) {
        checkoutStartKeyRef.current = null;
        setFormSaving(false);
        toast.error(errorMessage(error, "Secure checkout setup could not be started."));
      }
      return;
    }

    await saveNormalizedAddress(normalizedDraft);
  }

  return (
    <AddressDetailsShell>
      <div className="mb-6 flex items-center justify-between gap-3">
        <Link className="group inline-flex items-center gap-2 text-[15px] font-bold text-black transition-colors" href={mapPath}>
          <span className="flex size-8 items-center justify-center rounded-full bg-zinc-100 text-black transition-transform group-hover:-translate-x-1">
            <ArrowLeft size={16} />
          </span>
          Back to map
        </Link>
        {cartItemCount > 0 ? (
          <span className="rounded-full bg-zinc-100 px-3 py-1 text-[12px] font-bold text-zinc-600">
            {cartItemLabel}
          </span>
        ) : null}
      </div>

      <section className="mx-auto w-full max-w-2xl rounded-[32px] border border-zinc-200/60 bg-white p-6 shadow-[0_10px_30px_-10px_rgba(0,0,0,0.05)] sm:p-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-black">Add delivery address</h1>
          <p className="mt-2 text-sm font-medium text-zinc-500">
            Complete the address fields for the delivery point you selected.
          </p>
        </div>

        <form className="mt-8 grid gap-4 sm:grid-cols-2" noValidate onSubmit={saveAddress}>
          {/* Label selector as pill buttons */}
          <div className="mb-2 sm:col-span-2">
            <span className="mb-3 block text-[12px] font-bold uppercase tracking-wider text-zinc-500">Save address as</span>
            <div className="flex flex-wrap gap-3">
              {["Home", "Work", "Other"].map((l) => {
                const isSelected = 
                  l === "Other" 
                    ? draft.label !== "Home" && draft.label !== "Work" && draft.label !== undefined && draft.label !== null
                    : draft.label === l || (!draft.label && l === "Home");

                return (
                  <button
                    key={l}
                    type="button"
                    onClick={() => setDraftValue("label", l === "Other" ? "Other" : l)}
                    className={`flex h-12 items-center justify-center rounded-xl border px-6 text-[15px] font-semibold transition-all ${
                      isSelected
                        ? "border-black bg-black text-white shadow-md"
                        : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50 hover:text-black"
                    }`}
                  >
                    {l}
                  </button>
                );
              })}
            </div>
            {draft.label !== "Home" && draft.label !== "Work" && draft.label !== undefined && draft.label !== null && (
              <div className="mt-4 animate-slide-down">
                <TextInput 
                  label="Custom Label Name" 
                  onChange={(value) => setDraftValue("label", value)} 
                  value={draft.label ?? ""} 
                  placeholder="e.g. Grandma's House"
                />
              </div>
            )}
          </div>

          <TextInput
            autoComplete="name"
            className="sm:col-span-2"
            error={fieldErrors.recipientName}
            label="Recipient name"
            onBlur={() => validateField("recipientName")}
            onChange={(value) => setDraftValue("recipientName", value)}
            required
            value={draft.recipientName ?? ""}
          />
          {!session ? (
            <TextInput
              autoComplete="email"
              className="sm:col-span-2"
              error={fieldErrors.email}
              inputMode="email"
              label="Email"
              onBlur={() => validateField("email")}
              onChange={(value) => setDraftValue("email", value)}
              placeholder="you@example.com"
              required
              type="email"
              value={draft.email ?? ""}
            />
          ) : null}
          <TextInput
            autoComplete="tel"
            error={fieldErrors.recipientPhone}
            inputMode="tel"
            label="Recipient phone"
            maxLength={15}
            onBlur={() => validateField("recipientPhone")}
            onChange={(value) => setDraftValue("recipientPhone", formatIndianPhoneNumber(value))}
            placeholder="+91 98765 43210"
            required
            value={draft.recipientPhone ?? ""}
          />
          
          <TextInput
            autoComplete="address-line1"
            className="sm:col-span-2"
            error={fieldErrors.line1}
            label="House, flat, building, street"
            onBlur={() => validateField("line1")}
            onChange={(value) => setDraftValue("line1", value)}
            required
            value={draft.line1}
          />
          <TextInput autoComplete="address-line2" className="sm:col-span-2" label="Area, landmark" onChange={(value) => setDraftValue("line2", value)} value={draft.line2 ?? ""} />
          
          <TextInput
            autoComplete="address-level2"
            error={fieldErrors.city}
            label="City"
            onBlur={() => validateField("city")}
            onChange={(value) => setDraftValue("city", value)}
            required
            value={draft.city}
          />
          <TextInput
            autoComplete="address-level1"
            error={fieldErrors.state}
            label="State"
            onBlur={() => validateField("state")}
            onChange={(value) => setDraftValue("state", value)}
            required
            value={draft.state}
          />
          <TextInput
            autoComplete="postal-code"
            error={fieldErrors.pincode}
            inputMode="numeric"
            label="Pincode"
            maxLength={6}
            onBlur={() => validateField("pincode")}
            onChange={(value) => setDraftValue("pincode", value.replace(/\D/g, "").slice(0, 6))}
            required
            value={draft.pincode}
          />
          
          <TextInput className="sm:col-span-2" label="Delivery instructions (optional)" onChange={(value) => setDraftValue("deliveryInstructions", value)} value={draft.deliveryInstructions ?? ""} />

          <button
            className="group relative mt-4 flex h-14 items-center justify-center overflow-hidden rounded-2xl bg-black text-[15px] font-bold text-white shadow-lg transition-colors hover:bg-zinc-900 active:scale-[0.99] disabled:opacity-50 sm:col-span-2"
            disabled={formSaving || isAuthResolving}
            type="submit"
          >
            <div className="absolute inset-0 flex h-full w-full justify-center [transform:skew(-12deg)_translateX(-100%)] group-hover:duration-1000 group-hover:[transform:skew(-12deg)_translateX(100%)]">
              <div className="relative h-full w-8 bg-white/20" />
            </div>
            <span className="relative z-10 flex items-center gap-2">
              {formSaving || isAuthResolving ? <Loader2 className="size-5 animate-spin" /> : null}
              {formSaving
                ? "Saving address..."
                : isAuthResolving
                  ? "Checking session..."
                  : session
                    ? "Save and continue"
                    : "Verify phone and continue"}
            </span>
          </button>
        </form>
      </section>
    </AddressDetailsShell>
  );
}

function AddressDetailsShell({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-[100dvh] bg-zinc-50/50 px-4 pb-12 pt-6 font-sans sm:px-6 lg:px-8" id="main-content">
      <div className="mx-auto w-full max-w-4xl">
        {children}
      </div>
    </main>
  );
}

function TextInput({
  autoComplete,
  className = "",
  error,
  inputMode,
  label,
  maxLength,
  onBlur,
  onChange,
  placeholder,
  required,
  type = "text",
  value
}: {
  autoComplete?: InputHTMLAttributes<HTMLInputElement>["autoComplete"];
  className?: string;
  error?: string;
  inputMode?: InputHTMLAttributes<HTMLInputElement>["inputMode"];
  label: string;
  maxLength?: number;
  onBlur?: () => void;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  type?: InputHTMLAttributes<HTMLInputElement>["type"];
  value: string;
}) {
  const inputId = useId();
  const errorId = `${inputId}-error`;
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block text-[12px] font-bold uppercase tracking-wider text-zinc-500">{label}</span>
      <input
        aria-describedby={error ? errorId : undefined}
        aria-invalid={Boolean(error)}
        autoComplete={autoComplete}
        className={`h-12 w-full rounded-xl border bg-white px-4 text-[15px] font-medium text-black outline-none transition-all placeholder:text-zinc-400 ${
          error
            ? "border-rose-400 bg-rose-50/30 hover:border-rose-500 focus:border-rose-500 focus:ring-1 focus:ring-rose-200"
            : "border-zinc-200 hover:border-zinc-300 focus:border-black focus:ring-1 focus:ring-black"
        }`}
        id={inputId}
        inputMode={inputMode}
        maxLength={maxLength}
        onBlur={onBlur}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
        type={type}
        value={value}
      />
      {error ? (
        <p className="mt-1.5 text-xs font-semibold text-rose-600" id={errorId}>
          {error}
        </p>
      ) : null}
    </label>
  );
}

function normalizeAddressDraft(draft: AddressDraft): AddressDraft {
  const normalized: AddressDraft = {
    ...draft,
    city: draft.city.trim(),
    deliveryInstructions: draft.deliveryInstructions?.trim() ?? "",
    email: draft.email?.trim().toLowerCase() ?? "",
    label: draft.label?.trim() || "Home",
    line1: draft.line1.trim(),
    line2: draft.line2?.trim() ?? "",
    pincode: draft.pincode.replace(/\D/g, "").slice(0, 6),
    recipientName: draft.recipientName?.trim() ?? "",
    recipientPhone: formatIndianPhoneNumber(draft.recipientPhone ?? ""),
    state: draft.state.trim()
  };

  const latitude = normalizeCoordinate(draft.latitude, -90, 90);
  const longitude = normalizeCoordinate(draft.longitude, -180, 180);
  if (latitude === undefined || longitude === undefined) {
    delete normalized.latitude;
    delete normalized.longitude;
    return normalized;
  }
  normalized.latitude = latitude;
  normalized.longitude = longitude;
  return normalized;
}

function addressOnlyInput(draft: AddressDraft) {
  const addressInput = { ...draft };
  delete addressInput.email;
  return addressInput;
}

function validateAddressDraft(draft: AddressDraft, requireEmail: boolean): AddressFormErrors {
  const errors: AddressFormErrors = {};
  const keys = requireEmail ? ADDRESS_FORM_ERROR_KEYS : ADDRESS_FORM_ERROR_KEYS.filter((key) => key !== "email");
  for (const key of keys) {
    const message = validateAddressField(key, draft);
    if (message) {
      errors[key] = message;
    }
  }
  return errors;
}

const ADDRESS_FORM_ERROR_KEYS: AddressFormErrorKey[] = [
  "email",
  "recipientName",
  "recipientPhone",
  "line1",
  "city",
  "state",
  "pincode"
];

function validateAddressField(key: AddressFormErrorKey, draft: AddressDraft) {
  if (key === "email") {
    const value = draft.email?.trim() ?? "";
    if (!value) {
      return "Enter your email address.";
    }
    if (value.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      return "Enter a valid email address.";
    }
    return undefined;
  }

  if (key === "recipientName") {
    const value = draft.recipientName?.trim() ?? "";
    if (value.length < 2) {
      return "Enter the recipient name.";
    }
    if (value.length > 80) {
      return "Recipient name must be 80 characters or fewer.";
    }
    return undefined;
  }

  if (key === "recipientPhone") {
    const value = draft.recipientPhone?.trim() ?? "";
    if (!value) {
      return "Enter a recipient phone number.";
    }
    if (!isValidIndianPhoneNumber(value)) {
      return "Enter a valid 10-digit Indian mobile number.";
    }
    return undefined;
  }

  if (key === "line1") {
    const value = draft.line1.trim();
    if (value.length < 5) {
      return "Enter house, building, and street details.";
    }
    if (value.length > 160) {
      return "Address line must be 160 characters or fewer.";
    }
    return undefined;
  }

  if (key === "city") {
    const value = draft.city.trim();
    if (value.length < 2) {
      return "Enter the city.";
    }
    if (value.length > 80) {
      return "City must be 80 characters or fewer.";
    }
    return undefined;
  }

  if (key === "state") {
    const value = draft.state.trim();
    if (value.length < 2) {
      return "Enter the state.";
    }
    if (value.length > 80) {
      return "State must be 80 characters or fewer.";
    }
    return undefined;
  }

  const pincode = draft.pincode.replace(/\D/g, "");
  if (!/^[1-9]\d{5}$/.test(pincode)) {
    return "Enter a valid 6-digit pincode.";
  }
  return undefined;
}

function isAddressFormErrorKey(key: keyof AddressDraft): key is AddressFormErrorKey {
  return ADDRESS_FORM_ERROR_KEYS.includes(key as AddressFormErrorKey);
}

function clearFieldError(errors: AddressFormErrors, key: AddressFormErrorKey) {
  if (!errors[key]) {
    return errors;
  }
  const next = { ...errors };
  delete next[key];
  return next;
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    const body = error.body as { message?: unknown } | undefined;
    if (typeof body?.message === "string") {
      return body.message;
    }
    if (Array.isArray(body?.message)) {
      return body.message.join(", ");
    }
    return error.message || fallback;
  }
  return error instanceof Error ? error.message : fallback;
}

function checkoutPerfNow() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function logCheckoutPerf(stage: string, startedAt: number, metadata?: Record<string, unknown>) {
  if (!shouldLogCheckoutPerf()) {
    return;
  }
  const durationMs = Math.max(0, Math.round(checkoutPerfNow() - startedAt));
  const label = `${stage} ${".".repeat(Math.max(1, 26 - stage.length))}`;
  console.info(`[CHECKOUT] ${label} ${durationMs}ms`, metadata ?? {});
}

function shouldLogCheckoutPerf() {
  if (typeof window === "undefined") {
    return false;
  }
  if (process.env.NODE_ENV !== "production") {
    return true;
  }
  try {
    return localStorage.getItem("lotzi:checkout-perf") === "1";
  } catch {
    return false;
  }
}
