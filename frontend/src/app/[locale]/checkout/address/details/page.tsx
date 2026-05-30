"use client";

import { useEffect, useMemo, useState } from "react";
import type { FormEvent, HTMLAttributes, ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Loader2, Save } from "lucide-react";
import { Link, useRouter } from "@/i18n/navigation";
import { useAuthSession } from "@/components/session-refresh-provider";
import { useToast } from "@/components/toast/toast-context";
import { createCustomerAddress } from "@/features/customer-account/customer-account-api";
import {
  type AddressDraft,
  clearAddressDraft,
  emptyAddressDraft,
  persistAddressDraft,
  persistSelectedAddress,
  readAddressDraft,
  safeNextPath
} from "@/features/checkout/address-draft";
import { ApiError } from "@/lib/api";
import { useCart } from "@/lib/cart-context";

export default function CheckoutAddressDetailsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();
  const { cartItemCount } = useCart();
  const { isSessionReady, session } = useAuthSession();
  const nextPath = safeNextPath(searchParams.get("next"));
  const mapPath = useMemo(
    () => `/checkout/address?next=${encodeURIComponent(nextPath)}`,
    [nextPath]
  );

  const [draft, setDraft] = useState<AddressDraft>(() => emptyAddressDraft());
  const [draftHydrated, setDraftHydrated] = useState(false);
  const [formSaving, setFormSaving] = useState(false);
  const cartItemLabel = `${cartItemCount} cart ${cartItemCount === 1 ? "item" : "items"}`;

  useEffect(() => {
    const savedDraft = readAddressDraft();
    if (savedDraft) {
      setDraft((current) => ({ ...current, ...savedDraft }));
    }
    setDraftHydrated(true);
  }, []);

  useEffect(() => {
    if (!draftHydrated) {
      return;
    }
    persistAddressDraft(draft);
  }, [draft, draftHydrated]);

  function setDraftValue(key: keyof AddressDraft, value: string | boolean | number | undefined) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function saveAddress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) {
      persistAddressDraft(draft);
      router.push(`/auth/login?next=${encodeURIComponent(`/checkout/address/details?next=${encodeURIComponent(nextPath)}`)}`);
      return;
    }

    setFormSaving(true);
    try {
      const response = await createCustomerAddress({
        ...draft,
        isDefault: true,
        label: draft.label?.trim() || "Home",
        line1: draft.line1.trim(),
        city: draft.city.trim(),
        state: draft.state.trim(),
        pincode: draft.pincode.trim()
      });
      persistSelectedAddress(response.address.id);
      clearAddressDraft();
      toast.success("Delivery address saved.");
      router.push(nextPath);
    } catch (error) {
      toast.error(errorMessage(error, "Address could not be saved."));
    } finally {
      setFormSaving(false);
    }
  }

  if (!isSessionReady) {
    return <AddressDetailsShell><LoadingPanel label="Checking your session..." /></AddressDetailsShell>;
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

        <form className="mt-8 grid gap-4 sm:grid-cols-2" onSubmit={saveAddress}>
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

          <TextInput className="sm:col-span-2" label="Recipient name" onChange={(value) => setDraftValue("recipientName", value)} value={draft.recipientName ?? ""} />
          <TextInput label="Recipient phone" onChange={(value) => setDraftValue("recipientPhone", value)} value={draft.recipientPhone ?? ""} />
          <TextInput inputMode="numeric" label="Pincode" onChange={(value) => setDraftValue("pincode", value)} required value={draft.pincode} />
          
          <TextInput className="sm:col-span-2" label="House, flat, building, street" onChange={(value) => setDraftValue("line1", value)} required value={draft.line1} />
          <TextInput className="sm:col-span-2" label="Area, landmark" onChange={(value) => setDraftValue("line2", value)} value={draft.line2 ?? ""} />
          
          <TextInput label="City" onChange={(value) => setDraftValue("city", value)} required value={draft.city} />
          <TextInput label="State" onChange={(value) => setDraftValue("state", value)} required value={draft.state} />
          
          <TextInput className="sm:col-span-2" label="Delivery instructions" onChange={(value) => setDraftValue("deliveryInstructions", value)} value={draft.deliveryInstructions ?? ""} />

          <button
            className="mt-4 flex h-14 items-center justify-center gap-2 rounded-2xl bg-black text-[15px] font-bold text-white transition-all hover:-translate-y-0.5 hover:bg-zinc-900 hover:shadow-lg disabled:opacity-50 sm:col-span-2"
            disabled={formSaving}
            type="submit"
          >
            {formSaving ? <Loader2 className="size-5 animate-spin" /> : <Save size={18} />}
            {formSaving ? "Saving address..." : session ? "Save and continue" : "Continue to login"}
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

function LoadingPanel({ label }: { label: string }) {
  return (
    <div className="flex min-h-[120px] items-center justify-center gap-3 rounded-3xl border border-zinc-200/60 bg-white px-6 text-[15px] font-semibold text-zinc-500 shadow-sm">
      <Loader2 className="size-5 animate-spin text-black" />
      {label}
    </div>
  );
}

function TextInput({
  className = "",
  inputMode,
  label,
  onChange,
  required,
  value,
  placeholder
}: {
  className?: string;
  inputMode?: HTMLAttributes<HTMLInputElement>["inputMode"];
  label: string;
  onChange: (value: string) => void;
  required?: boolean;
  value: string;
  placeholder?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block text-[12px] font-bold uppercase tracking-wider text-zinc-500">{label}</span>
      <input
        className="h-12 w-full rounded-xl border border-zinc-200 bg-white px-4 text-[15px] font-medium text-black outline-none transition-all placeholder:text-zinc-400 hover:border-zinc-300 focus:border-black focus:ring-1 focus:ring-black"
        inputMode={inputMode}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        value={value}
        placeholder={placeholder}
      />
    </label>
  );
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
