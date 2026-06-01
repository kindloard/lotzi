/* eslint-disable @next/next/no-img-element */
"use client";

import { memo, useEffect, useRef } from "react";
import { useRouter } from "@/i18n/navigation";
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Check,
  ChevronLeft,
  Loader2,
  MapPin,
  Palette,
  Send,
  Save,
  Settings,
  ShieldCheck,
  Store,
  X
} from "lucide-react";
import { OnboardingPayload, OnboardingStep } from "@/lib/merchant-onboarding-api";
import { useOnboarding } from "./hooks/useOnboarding";
import { BrandingStep, BusinessStep, LegalStep, LocationStep, PreferencesStep, ReviewStep } from "./components/Steps";

const steps: Array<{
  id: OnboardingStep;
  label: string;
  eyebrow: string;
  icon: typeof Store;
}> = [
  { id: "BUSINESS", label: "Business Basics", eyebrow: "Identity", icon: Store },
  { id: "BRANDING", label: "Store Branding", eyebrow: "Presence", icon: Palette },
  { id: "LEGAL", label: "Business Details", eyebrow: "Trust", icon: BadgeCheck },
  { id: "LOCATION", label: "Shop Location", eyebrow: "GPS", icon: MapPin },
  { id: "PREFERENCES", label: "Preferences", eyebrow: "Operations", icon: Settings },
  { id: "REVIEW", label: "Review & Submit", eyebrow: "Approval", icon: Send }
];

const stepIndex = new Map(steps.map((step, index) => [step.id, index]));

export function MerchantOnboardingWizard() {
  const router = useRouter();
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  const {
    bootstrap,
    values,
    currentStep,
    loading,
    redirecting,
    savingState,
    submitting,
    launching,
    launched,
    errors,
    currentErrors,
    uploadState,
    setCurrentStep,
    setErrors,
    updateValue,
    saveCurrentDraft,
    completeCurrentStep,
    handleLaunch,
    uploadAsset
  } = useOnboarding();

  useEffect(() => {
    headingRef.current?.focus();
  }, [currentStep]);

  if (loading || redirecting) {
    return <OnboardingSkeleton />;
  }

  if (!bootstrap || !bootstrap.rules) {
    return (
      <main className="min-h-[100dvh] bg-white px-5 py-10 flex items-center justify-center">
        <div className="mx-auto max-w-md rounded-2xl border border-zinc-200 bg-white p-8 text-center shadow-md">
          <div className="mx-auto flex size-10 items-center justify-center rounded-xl bg-rose-50 text-rose-600 mb-4">
            <X size={18} />
          </div>
          <h1 className="text-base font-semibold text-zinc-900 tracking-tight">Unable to load onboarding</h1>
          <p className="mt-2 text-xs font-normal text-zinc-500">{errors[0]?.message ?? "Please sign in again."}</p>
        </div>
      </main>
    );
  }

  const activeIndex = stepIndex.get(currentStep) ?? 0;
  const rules = bootstrap.rules;
  const completionPercent = Math.max(bootstrap.state.completionPercent ?? 0, Math.round((activeIndex / steps.length) * 100));

  const goBack = () => {
    if (activeIndex === 0) {
      router.push("/");
      return;
    }
    setErrors([]);
    setCurrentStep(steps[activeIndex - 1].id);
  };

  return (
    <main className="min-h-[100dvh] bg-white font-sans font-medium text-zinc-950 selection:bg-zinc-900 selection:text-white">
      <div className="mx-auto grid min-h-[100dvh] max-w-[1440px] grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)_340px]">
        {/* Left Sidebar */}
        <aside className="hidden sticky top-0 h-screen overflow-y-auto border-r border-zinc-200 bg-zinc-50/50 px-6 py-8 lg:block">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-xl bg-zinc-950 text-white shadow-sm">
              <Store size={16} />
            </div>
            <div className="min-w-0">
              <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-zinc-400">Namastore</p>
              <p className="text-[13px] font-semibold text-zinc-950 truncate leading-tight">{bootstrap.store.name}</p>
            </div>
          </div>
          <ProgressRail currentStep={currentStep} completionPercent={completionPercent} />
          <div className="mt-8 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
            <ShieldCheck size={16} className="text-zinc-900" />
            <p className="mt-2.5 text-[13px] font-semibold tracking-tight text-zinc-950">Auto-saving drafts</p>
            <p className="mt-1 text-xs font-normal leading-relaxed text-zinc-500">
              Your progress is saved securely. You can leave and return anytime before submitting for review.
            </p>
          </div>
        </aside>

        {/* Main Content Area */}
        <section className="flex min-h-[100dvh] flex-col bg-white">
          {/* Mobile Header */}
          <header className="sticky top-0 z-20 border-b border-zinc-200 bg-white px-5 py-4 lg:hidden">
            <div className="relative flex items-center justify-between min-h-[40px]">
              <div className="z-10 flex-shrink-0">
                <button
                  aria-label="Go back"
                  className="flex size-9 items-center justify-center rounded-xl border border-zinc-200 bg-white text-zinc-900 transition hover:bg-zinc-50 focus:outline-none"
                  onClick={goBack}
                  type="button"
                >
                  <ChevronLeft size={16} />
                </button>
              </div>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <p className="truncate text-base font-semibold tracking-tight text-zinc-900">{steps[activeIndex].label}</p>
              </div>
              <div className="z-10 flex-shrink-0">
                <DraftStatusPill state={savingState} compact />
              </div>
            </div>
            {/* Mobile Progress Bar */}
            <div
              className="absolute bottom-0 left-0 h-[2px] bg-zinc-950 transition-all duration-500 ease-in-out"
              style={{ width: `${Math.max(completionPercent, 5)}%` }}
            />
          </header>

          <div className="flex-1 px-5 py-6 sm:px-8 lg:px-12 lg:py-12">
            <div className="mx-auto max-w-2xl">
              <div className="hidden items-center justify-between lg:flex">
                <button
                  className="group inline-flex h-9 items-center gap-1.5 rounded-xl px-2.5 text-[13px] font-semibold text-zinc-500 transition-colors hover:bg-zinc-50 hover:text-zinc-950 focus:outline-none"
                  onClick={goBack}
                  type="button"
                >
                  <ArrowLeft size={14} className="transition-transform group-hover:-translate-x-0.5" />
                  {activeIndex === 0 ? "Exit Setup" : "Back"}
                </button>
                <DraftStatusPill state={savingState} />
              </div>

              <div className="hidden lg:block mt-10 animate-in fade-in slide-in-from-bottom-3 duration-400">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">{steps[activeIndex].eyebrow}</p>
                <h1
                  className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900 outline-none sm:text-3xl"
                  ref={headingRef}
                  tabIndex={-1}
                >
                  {steps[activeIndex].label}
                </h1>
              </div>

              <div className="mt-2 lg:mt-8">
                {currentStep === "BUSINESS" && (
                  <BusinessStep errors={currentErrors} rules={rules} updateValue={updateValue} values={values.BUSINESS} />
                )}
                {currentStep === "BRANDING" && (
                  <BrandingStep
                    errors={currentErrors}
                    uploadAsset={uploadAsset}
                    uploadState={uploadState}
                    updateValue={updateValue}
                    values={values.BRANDING}
                  />
                )}
                {currentStep === "LEGAL" && (
                  <LegalStep errors={currentErrors} rules={rules} updateValue={updateValue} values={values.LEGAL} />
                )}
                {currentStep === "LOCATION" && (
                  <LocationStep errors={currentErrors} updateValue={updateValue} values={values.LOCATION} />
                )}
                {currentStep === "PREFERENCES" && (
                  <PreferencesStep errors={currentErrors} rules={rules} updateValue={updateValue} values={values.PREFERENCES} />
                )}
                {currentStep === "REVIEW" && (
                  <ReviewStep
                    bootstrap={bootstrap}
                    errors={errors}
                    launching={launching}
                    onLaunch={handleLaunch}
                    values={values}
                  />
                )}
              </div>
            </div>
          </div>

          {/* Sticky Bottom Actions */}
          {currentStep !== "REVIEW" && (
            <footer className="sticky bottom-0 z-20 border-t border-zinc-200 bg-white/80 px-5 py-4 backdrop-blur-md pb-safe">
              <div className="mx-auto flex max-w-2xl items-center justify-between gap-4">
                <button
                  className="hidden h-10 items-center justify-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-4 text-[13px] font-medium text-zinc-800 transition hover:bg-zinc-50 hover:border-zinc-300 active:scale-95 disabled:opacity-50 sm:inline-flex focus:outline-none"
                  disabled={savingState === "saving" || submitting}
                  onClick={saveCurrentDraft}
                  type="button"
                >
                  {savingState === "saving" ? <Loader2 className="animate-spin" size={15} /> : <Save size={15} />}
                  Save Draft
                </button>
                <button
                  className="inline-flex h-12 flex-1 items-center justify-center gap-1.5 rounded-xl bg-zinc-950 px-5 text-[13px] font-medium text-white shadow-sm transition-all hover:bg-zinc-900 active:scale-95 disabled:pointer-events-none disabled:opacity-50 sm:flex-none sm:w-[180px] focus:outline-none"
                  disabled={submitting}
                  onClick={completeCurrentStep}
                  type="button"
                >
                  {submitting ? <Loader2 className="animate-spin" size={15} /> : "Continue"}
                  {!submitting && <ArrowRight size={15} />}
                </button>
              </div>
            </footer>
          )}
        </section>

        {/* Right Sidebar - Preview */}
        <aside className="hidden border-l border-zinc-200 bg-zinc-50/30 px-6 py-8 xl:block">
          <StorePreview values={values} />
        </aside>
      </div>

      {launched && <LaunchOverlay />}
    </main>
  );
}

const StorePreview = memo(function StorePreview({ values }: { values: Record<OnboardingStep, OnboardingPayload> }) {
  const business = values.BUSINESS;
  const branding = values.BRANDING;
  const accentColor = stringValue(branding.accentColor) || "#f4f4f5";
  const primaryColor = stringValue(branding.primaryColor) || "#000000";
  const bannerUrl = stringValue(branding.bannerUrl);
  const logoUrl = stringValue(branding.logoUrl);
  const storeName = stringValue(business.storeName);
  const description = stringValue(branding.description);

  return (
    <div className="sticky top-8">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Live Preview</p>
      <div className="mt-4 overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm transition-all duration-500 hover:shadow-md">
        <div
          className="h-32 bg-zinc-100 transition-colors duration-500"
          style={{ backgroundColor: accentColor }}
        >
          {bannerUrl && <img alt="" className="h-full w-full object-cover animate-in fade-in" src={bannerUrl} />}
        </div>
        <div className="p-6">
          <div
            className="-mt-14 flex size-16 items-center justify-center overflow-hidden rounded-xl border-4 border-white text-xl font-semibold text-white shadow-sm transition-colors duration-500"
            style={{ backgroundColor: primaryColor }}
          >
            {logoUrl ? (
              <img alt="" className="h-full w-full object-cover animate-in fade-in" src={logoUrl} />
            ) : (
              (storeName.substring(0, 1) || "S").toUpperCase()
            )}
          </div>
          <h2 className="mt-4 text-base font-semibold tracking-tight text-zinc-950">{storeName || "Your Store"}</h2>
          <p className="mt-2 text-xs font-normal leading-relaxed text-zinc-500">{description || "Your storefront preview updates as you set up your brand."}</p>
        </div>
      </div>
    </div>
  );
});

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

const ProgressRail = memo(function ProgressRail({ completionPercent, currentStep }: { completionPercent: number; currentStep: OnboardingStep }) {
  return (
    <div className="mt-10">
      <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
        <span>Progress</span>
        <span className="font-mono">{completionPercent}%</span>
      </div>
      <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-zinc-200">
        <div className="h-full rounded-full bg-zinc-950 transition-all duration-700 ease-out" style={{ width: `${completionPercent}%` }} />
      </div>
      <div className="mt-8 space-y-1">
        {steps.map((step) => {
          const Icon = step.icon;
          const active = step.id === currentStep;
          const done = (stepIndex.get(step.id) ?? 0) < (stepIndex.get(currentStep) ?? 0);
          return (
            <div
              aria-current={active ? "step" : undefined}
              className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-semibold transition-all ${
                active
                  ? "bg-white shadow-sm border border-zinc-200 text-zinc-900"
                  : done
                    ? "text-zinc-500 hover:bg-zinc-100"
                    : "text-zinc-400"
              }`}
              key={step.id}
            >
              <div className={`flex size-6 items-center justify-center rounded-lg ${active ? "bg-zinc-950 text-white" : done ? "bg-zinc-150 text-zinc-900 border border-zinc-200" : "bg-transparent text-zinc-400 group-hover:text-zinc-600"}`}>
                {done ? <Check size={11} strokeWidth={2.5} /> : <Icon size={12} />}
              </div>
              <span>{step.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
});

const DraftStatusPill = memo(function DraftStatusPill({ state, compact = false }: { state: "idle" | "saving" | "saved" | "error"; compact?: boolean }) {
  if (state === "idle") return null;

  const label = state === "saving" ? "Saving..." : state === "error" ? "Save Failed" : "Saved";
  return (
    <span className={`inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[10px] font-medium uppercase tracking-wider transition-colors animate-in fade-in ${
      state === "error" ? "bg-red-50 text-red-600 border border-red-100" : "bg-zinc-100 text-zinc-600"
    }`}>
      {state === "saving" ? <Loader2 className="animate-spin" size={11} /> : state === "error" ? <X size={11} strokeWidth={2.5} /> : <Check size={11} strokeWidth={2.5} />}
      {!compact && label}
    </span>
  );
});

function OnboardingSkeleton() {
  return (
    <main className="min-h-[100dvh] bg-white px-5 py-8">
      <div className="mx-auto grid max-w-[1440px] gap-6 lg:grid-cols-[260px_minmax(0,1fr)_340px]">
        <div className="hidden h-[540px] rounded-2xl bg-zinc-50/50 border border-zinc-100 lg:block animate-pulse" />
        <div className="h-[540px] p-6 sm:p-12">
          <div className="h-3 w-24 rounded bg-zinc-100 animate-pulse" />
          <div className="mt-4 h-8 w-56 rounded-lg bg-zinc-100 animate-pulse" />
          <div className="mt-10 space-y-5">
            <div className="h-12 w-full rounded-xl bg-zinc-50 animate-pulse" />
            <div className="h-12 w-full rounded-xl bg-zinc-50 animate-pulse" />
            <div className="h-12 w-full rounded-xl bg-zinc-50 animate-pulse" />
          </div>
        </div>
      </div>
    </main>
  );
}

function LaunchOverlay() {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-white/95 px-5 backdrop-blur-md animate-in fade-in duration-500">
      <div className="rounded-2xl bg-white p-10 text-center shadow-2xl shadow-black/5 animate-in zoom-in-95 duration-500 delay-150 border border-zinc-200">
        <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-zinc-950 text-white shadow-sm">
          <Check size={28} strokeWidth={2.5} className="animate-in zoom-in duration-500 delay-300" />
        </div>
        <h2 className="mt-6 text-xl font-semibold tracking-tight text-zinc-950">Profile Submitted</h2>
        <p className="mt-3 text-xs font-normal text-zinc-500">Your store profile is waiting for approval review.</p>
      </div>
    </div>
  );
}
