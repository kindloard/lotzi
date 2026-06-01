/* eslint-disable @next/next/no-img-element */
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { OnboardingBootstrap, OnboardingPayload, OnboardingRules, OnboardingStep } from "@/lib/merchant-onboarding-api";
import { UploadState } from "../hooks/useOnboarding";
import {
  DEFAULT_BUSINESS_HOURS,
  normalizeBusinessHours,
  numberValue,
  record,
  roundCoordinate,
  text
} from "../onboarding-utils";
import { Input } from "./ui/Input";
import { Select } from "./ui/Select";
import { UploadZone } from "./ui/UploadZone";
import { AlertTriangle, CheckCircle2, Loader2, LocateFixed, MapPin, RefreshCw, Send, Briefcase, ShieldCheck, Clock } from "lucide-react";

const GPS_ACCURACY_THRESHOLD_METERS = 200;
const GPS_TIMEOUT_MS = 15000;
const DEFAULT_OPEN_TIME = "9:00 AM";
const DEFAULT_CLOSE_TIME = "8:00 PM";
const BUSINESS_TIME_OPTIONS = buildBusinessTimeOptions();
const BUSINESS_TIME_VALUES = new Set(BUSINESS_TIME_OPTIONS.map((option) => option.value));
const LEGACY_DEFAULT_BUSINESS_HOURS: Record<string, string> = {
  monday: "9:00 AM - 6:00 PM",
  tuesday: "9:00 AM - 6:00 PM",
  wednesday: "9:00 AM - 6:00 PM",
  thursday: "9:00 AM - 6:00 PM",
  friday: "9:00 AM - 6:00 PM",
  saturday: "10:00 AM - 4:00 PM"
};

interface StepProps {
  errors: Record<string, string>;
  rules: OnboardingRules;
  updateValue: (step: OnboardingStep, field: string, value: unknown) => void;
  values: OnboardingPayload;
}

function isMobileBrowser() {
  if (typeof navigator === "undefined") {
    return false;
  }
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

function insecureLocationMessage() {
  return isMobileBrowser()
    ? "Open this page on HTTPS, then allow location."
    : "Open this page on HTTPS or localhost, then allow location.";
}

function initials(value: string) {
  const parts = value.trim().split(/\s+/).slice(0, 2);
  return (parts.map((part) => part[0]).join("") || "N").toUpperCase();
}

export function BusinessStep({ errors, rules, updateValue, values }: StepProps) {
  // Auto-set India defaults
  useEffect(() => {
    if (values.country !== "IN") updateValue("BUSINESS", "country", "IN");
  }, [values.country, updateValue]);

  // Inject Local Merchant option
  const businessTypeOptions = [
    ...rules.options.businessTypes.filter(t => t.value !== "unregistered"),
    { value: "unregistered", label: "Local Merchant" }
  ];

  return (
    <div className="grid gap-6 sm:grid-cols-2 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <Input
        dataField="storeName"
        error={errors.storeName}
        label="Store Name"
        onChange={(event) => updateValue("BUSINESS", "storeName", event.target.value)}
        value={text(values.storeName)}
        placeholder="Acme Corp"
      />
      <Input
        dataField="phone"
        error={errors.phone}
        inputMode="tel"
        label="Business Phone"
        onChange={(event) => {
          let val = event.target.value;
          
          if (val === "+91 " || val === "+91" || val === "+9" || val === "+" || val === "") {
            updateValue("BUSINESS", "phone", "");
            return;
          }

          if (val.startsWith("+91 ")) val = val.substring(4);
          else if (val.startsWith("+91")) val = val.substring(3);
          else if (val.replace(/\D/g, "").startsWith("91") && val.replace(/\D/g, "").length === 12) val = val.replace(/\D/g, "").substring(2);
          else if (val.replace(/\D/g, "").startsWith("0") && val.replace(/\D/g, "").length === 11) val = val.replace(/\D/g, "").substring(1);

          val = val.replace(/\D/g, "");
          if (val.length > 10) val = val.substring(0, 10);

          updateValue("BUSINESS", "phone", val.length > 0 ? `+91 ${val}` : "");
        }}
        value={text(values.phone)}
        placeholder="+91 9876543210"
      />
      <Select
        dataField="category"
        error={errors.category}
        label="Business Category"
        onValueChange={(value) => updateValue("BUSINESS", "category", value)}
        options={rules.options.categories}
        value={text(values.category)}
      />
      <Select
        dataField="businessType"
        error={errors.businessType}
        label="Business Type"
        onValueChange={(value) => updateValue("BUSINESS", "businessType", value)}
        options={businessTypeOptions}
        value={text(values.businessType)}
      />
    </div>
  );
}

export function BrandingStep({
  errors,
  uploadAsset,
  uploadState,
  updateValue,
  values
}: Omit<StepProps, "rules"> & {
  uploadAsset: (kind: "LOGO" | "BANNER", file: File) => void;
  uploadState: UploadState;
}) {
  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="grid gap-6 lg:grid-cols-2">
        <UploadZone
          error={errors.logo}
          kind="LOGO"
          label="Logo"
          onFile={uploadAsset}
          previewUrl={text(values.logoUrl)}
          state={uploadState.LOGO ?? "idle"}
        />
        <UploadZone
          error={errors.banner}
          kind="BANNER"
          label="Cover Banner"
          onFile={uploadAsset}
          previewUrl={text(values.bannerUrl)}
          state={uploadState.BANNER ?? "idle"}
        />
      </div>

      <div className="mt-6 grid gap-6">
        <Input
          dataField="tagline"
          error={errors.tagline}
          label="Brand Tagline"
          maxLength={90}
          onChange={(event) => updateValue("BRANDING", "tagline", event.target.value)}
          value={text(values.tagline)}
          placeholder="Crafting excellence daily"
        />
        <label className="block w-full">
          <span className="text-[13px] font-semibold text-zinc-900 tracking-tight">Store Description</span>
          <div className="relative mt-1.5">
            <textarea
              data-field="description"
              maxLength={250}
              rows={4}
              value={text(values.description)}
              onChange={(event) => updateValue("BRANDING", "description", event.target.value)}
              className={`
                flex w-full min-h-[112px] resize-none rounded-lg border bg-white px-3 py-3 text-sm text-zinc-900 shadow-sm
                transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]
                placeholder:text-zinc-400
                focus:outline-none focus:ring-4
                ${
                  errors.description
                    ? "border-red-400 focus:border-red-600 focus:ring-red-600/10"
                    : "border-zinc-200 hover:border-zinc-300 focus:border-zinc-900 focus:ring-zinc-900/10"
                }
              `}
              placeholder="Tell your story..."
            />
          </div>
          <div className="mt-1.5 flex justify-between items-center">
            {errors.description ? (
              <span className="block text-xs font-medium text-red-600">
                {errors.description}
              </span>
            ) : <span />}
            <span className="text-[11px] font-medium text-zinc-400">
              {text(values.description).length} / 250
            </span>
          </div>
        </label>
      </div>
    </div>
  );
}

export function LegalStep({ errors, rules, updateValue, values }: StepProps) {
  const required = new Set((rules.required.LEGAL ?? []).map((rule) => rule.field));
  return (
    <div className="grid gap-6 sm:grid-cols-2 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <Input
        dataField="legalName"
        error={errors.legalName}
        label="Legal Business Name"
        optional={true}
        onChange={(event) => updateValue("LEGAL", "legalName", event.target.value)}
        value={text(values.legalName)}
      />
      {required.has("gstin") ? (
        <Input
          dataField="gstin"
          error={errors.gstin}
          label="GSTIN"
          optional={true}
          onChange={(event) => updateValue("LEGAL", "gstin", event.target.value.toUpperCase())}
          value={text(values.gstin)}
        />
      ) : (
        <Input
          dataField="registrationNumber"
          error={errors.registrationNumber}
          label="Registration Number"
          optional={true}
          onChange={(event) => updateValue("LEGAL", "registrationNumber", event.target.value)}
          value={text(values.registrationNumber)}
        />
      )}
      <Input
        dataField="contactEmail"
        error={errors.contactEmail}
        inputMode="email"
        label="Contact Email"
        onChange={(event) => updateValue("LEGAL", "contactEmail", event.target.value)}
        value={text(values.contactEmail)}
      />
      <Input
        dataField="addressLine"
        error={errors.addressLine}
        label="Business Address"
        onChange={(event) => updateValue("LEGAL", "addressLine", event.target.value)}
        value={text(values.addressLine)}
      />
      <Input
        dataField="city"
        error={errors.city}
        label="City"
        onChange={(event) => updateValue("LEGAL", "city", event.target.value)}
        value={text(values.city)}
      />
      <Input
        dataField="state"
        error={errors.state}
        label="State"
        onChange={(event) => updateValue("LEGAL", "state", event.target.value)}
        value={text(values.state)}
      />
      <Input
        dataField="pincode"
        error={errors.pincode}
        label="Postal Code"
        onChange={(event) => updateValue("LEGAL", "pincode", event.target.value)}
        value={text(values.pincode)}
      />
    </div>
  );
}

export function LocationStep({
  errors,
  updateValue,
  values
}: Omit<StepProps, "rules">) {
  const latitude = numberValue(values.latitude);
  const longitude = numberValue(values.longitude);
  const hasCoordinates = latitude !== undefined && longitude !== undefined;
  const mobile = isMobileBrowser();
  const [captureState, setCaptureState] = useState<"idle" | "capturing" | "error">("idle");
  const [captureError, setCaptureError] = useState<{ title: string; message: string } | null>(null);
  const validationError = errors.latitude ?? errors.longitude ?? errors.accuracy;

  const captureLocation = useCallback(() => {
    if (!window.isSecureContext) {
      setCaptureState("error");
      setCaptureError({
        title: "Secure connection required",
        message: insecureLocationMessage()
      });
      return;
    }

    if (!("geolocation" in navigator)) {
      setCaptureState("error");
      setCaptureError({
        title: "Location is not available",
        message: mobile
          ? "Turn on location permission for this browser and try again."
          : "This browser does not support GPS location capture."
      });
      return;
    }

    setCaptureState("capturing");
    setCaptureError(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const nextAccuracy = position.coords.accuracy;
        if (nextAccuracy > GPS_ACCURACY_THRESHOLD_METERS) {
          setCaptureState("error");
          setCaptureError({
            title: "Location is not clear enough",
            message: "Move closer to your shop entrance and try again."
          });
          return;
        }

        updateValue("LOCATION", "latitude", roundCoordinate(position.coords.latitude));
        updateValue("LOCATION", "longitude", roundCoordinate(position.coords.longitude));
        updateValue("LOCATION", "accuracy", Math.round(nextAccuracy));
        setCaptureState("idle");
      },
      (error) => {
        setCaptureState("error");
        setCaptureError(errorMessageForGeolocation(error));
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: GPS_TIMEOUT_MS
      }
    );
  }, [mobile, updateValue]);

  return (
    <div className="flex min-h-[calc(100dvh-250px)] items-center justify-center animate-in fade-in slide-in-from-bottom-2 duration-500 lg:min-h-[420px]">
      <div className="flex w-full flex-col items-center">
        {hasCoordinates ? (
          <div className="w-full max-w-[288px] rounded-2xl border border-zinc-200 bg-white p-5 text-center shadow-sm">
            <div className="flex flex-col items-center">
              <CheckCircle2 className="text-zinc-950" size={22} />
              <p className="mt-3 text-sm font-semibold text-zinc-950">Location saved</p>
              <p className="mt-1 text-sm font-medium leading-relaxed text-zinc-500">You can continue, or update it if you moved.</p>
            </div>
            <button
              className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-zinc-950 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-zinc-900 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none"
              data-field="latitude"
              disabled={captureState === "capturing"}
              onClick={captureLocation}
              type="button"
            >
              {captureState === "capturing" ? <Loader2 className="animate-spin" size={16} /> : <RefreshCw size={16} />}
              {captureState === "capturing" ? "Getting location" : "Update location"}
            </button>
          </div>
        ) : (
          <div className="w-full max-w-[288px] text-center">
            <div className="flex flex-col items-center">
              <div className="flex size-12 items-center justify-center rounded-xl bg-zinc-950 text-white shadow-sm">
                <MapPin size={22} />
              </div>
              <h3 className="mt-4 text-lg font-semibold tracking-tight text-zinc-900">Select location</h3>
              <p className="mt-1 text-sm font-medium leading-relaxed text-zinc-500">
                Stand at your shop and use your current location.
              </p>
            </div>

            <button
              className="mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-zinc-950 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-zinc-900 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none"
              data-field="latitude"
              disabled={captureState === "capturing"}
              onClick={captureLocation}
              type="button"
            >
              {captureState === "capturing" ? <Loader2 className="animate-spin" size={16} /> : <LocateFixed size={16} />}
              {captureState === "capturing" ? "Getting location" : "Use current location"}
            </button>
          </div>
        )}

        {(captureError || validationError) && (
          <div className="mt-5 w-full rounded-xl border border-red-200 bg-red-50 p-4" role="alert">
            <div className="flex gap-3">
              <AlertTriangle className="mt-0.5 shrink-0 text-red-600" size={18} />
              <div>
                <p className="text-sm font-semibold text-red-900">{captureError?.title ?? "Location is required"}</p>
                <p className="mt-1 text-sm font-medium leading-relaxed text-red-700">
                  {captureError?.message ?? validationError}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function PreferencesStep({ updateValue, values }: StepProps) {
  const businessHours = normalizeBusinessHours({
    ...DEFAULT_BUSINESS_HOURS,
    ...record(values.businessHours)
  });
  const displayBusinessHours = withCurrentDefaultBusinessHours(businessHours);

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="grid gap-8">
        <div>
          <h3 className="mb-4 text-base font-semibold text-zinc-950">Business Hours</h3>
          <div className="grid gap-4">
            {Object.entries(displayBusinessHours).map(([day, value]) => (
              <BusinessHoursDayRow
                day={day}
                key={day}
                onChange={(nextValue) =>
                  updateValue("PREFERENCES", "businessHours", {
                    ...displayBusinessHours,
                    [day]: nextValue
                  })
                }
                value={String(value)}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function withCurrentDefaultBusinessHours(hours: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(hours).map(([day, value]) => [
      day,
      LEGACY_DEFAULT_BUSINESS_HOURS[day] === value ? DEFAULT_BUSINESS_HOURS[day as keyof typeof DEFAULT_BUSINESS_HOURS] : value
    ])
  );
}

function BusinessHoursDayRow({
  day,
  onChange,
  value
}: {
  day: string;
  onChange: (value: string) => void;
  value: string;
}) {
  const selection = parseBusinessHourSelection(value);
  const closeOptions = closeTimeOptionsAfter(selection.openTime);

  const toggleOpen = () => {
    onChange(
      selection.isClosed
        ? formatBusinessHourRange(selection.openTime, selection.closeTime)
        : "closed"
    );
  };

  const setOpenTime = (openTime: string) => {
    const closeTime = isLaterTime(selection.closeTime, openTime)
      ? selection.closeTime
      : nextCloseTime(openTime);
    onChange(formatBusinessHourRange(openTime, closeTime));
  };

  const setCloseTime = (closeTime: string) => {
    onChange(formatBusinessHourRange(selection.openTime, closeTime));
  };

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-4">
        <p className="text-[15px] font-semibold capitalize text-zinc-950">{day}</p>
        <button
          aria-checked={!selection.isClosed}
          className="inline-flex shrink-0 items-center gap-2 rounded-full py-0.5 pl-2 text-[12px] font-semibold text-zinc-700 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950/20"
          onClick={toggleOpen}
          role="switch"
          type="button"
        >
          <span>{selection.isClosed ? "Closed" : "Open"}</span>
          <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition ${selection.isClosed ? "bg-zinc-950/20" : "bg-zinc-950"}`}>
            <span className={`size-4 rounded-full bg-white shadow-sm transition ${selection.isClosed ? "translate-x-0.5" : "translate-x-[18px]"}`} />
          </span>
        </button>
      </div>

      {selection.isClosed ? (
        <div className="mt-4 rounded-xl border border-zinc-100 bg-zinc-50 px-3 py-3 text-sm font-medium text-zinc-500">
          Closed for the day
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Select
            label="From"
            onValueChange={setOpenTime}
            options={BUSINESS_TIME_OPTIONS}
            value={selection.openTime}
          />
          <Select
            label="To"
            onValueChange={setCloseTime}
            options={closeOptions}
            value={selection.closeTime}
          />
        </div>
      )}
    </div>
  );
}

function buildBusinessTimeOptions() {
  return Array.from({ length: 48 }, (_, index) => {
    const totalMinutes = index * 30;
    const label = formatTime(totalMinutes);
    return { value: label, label };
  });
}

function parseBusinessHourSelection(value: string) {
  const normalized = normalizeBusinessHours({ day: value }).day;
  const trimmed = normalized.trim();

  if (!trimmed || trimmed.toLowerCase() === "closed") {
    return {
      isClosed: true,
      openTime: DEFAULT_OPEN_TIME,
      closeTime: DEFAULT_CLOSE_TIME
    };
  }

  const range = trimmed.match(/^(.+?)\s*-\s*(.+)$/);
  const openTime = normalizeTimeOption(range?.[1] ?? "") ?? DEFAULT_OPEN_TIME;
  const rawCloseTime = normalizeTimeOption(range?.[2] ?? "") ?? DEFAULT_CLOSE_TIME;
  const closeTime = isLaterTime(rawCloseTime, openTime) ? rawCloseTime : nextCloseTime(openTime);

  return {
    isClosed: false,
    openTime,
    closeTime
  };
}

function normalizeTimeOption(value: string) {
  const text = value.trim().toUpperCase().replace(/\s+/g, " ");
  const twelveHour = text.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/);
  if (twelveHour) {
    const hour = Number(twelveHour[1]);
    const minute = Number(twelveHour[2] ?? "0");
    if (hour >= 1 && hour <= 12 && minute >= 0 && minute < 60) {
      return closestTimeOption(toMinutes(`${hour}:${String(minute).padStart(2, "0")} ${twelveHour[3]}`));
    }
  }

  const twentyFourHour = text.match(/^(\d{1,2}):(\d{2})$/);
  if (twentyFourHour) {
    const hour = Number(twentyFourHour[1]);
    const minute = Number(twentyFourHour[2]);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute < 60) {
      return closestTimeOption(hour * 60 + minute);
    }
  }

  return BUSINESS_TIME_VALUES.has(text) ? text : null;
}

function closestTimeOption(totalMinutes: number) {
  const roundedMinutes = Math.min(23 * 60 + 30, Math.max(0, Math.round(totalMinutes / 30) * 30));
  return formatTime(roundedMinutes);
}

function closeTimeOptionsAfter(openTime: string) {
  const options = BUSINESS_TIME_OPTIONS.filter((option) => isLaterTime(option.value, openTime));
  return options.length ? options : BUSINESS_TIME_OPTIONS;
}

function nextCloseTime(openTime: string) {
  return closeTimeOptionsAfter(openTime)[0]?.value ?? DEFAULT_CLOSE_TIME;
}

function formatBusinessHourRange(openTime: string, closeTime: string) {
  return `${openTime} - ${closeTime}`;
}

function isLaterTime(value: string, reference: string) {
  return toMinutes(value) > toMinutes(reference);
}

function toMinutes(value: string) {
  const match = value.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) {
    return 0;
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const period = match[3].toUpperCase();
  const hour24 = period === "AM" ? hour % 12 : (hour % 12) + 12;
  return hour24 * 60 + minute;
}

function formatTime(totalMinutes: number) {
  const hour24 = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  const period = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${period}`;
}

function businessHoursSummary(value: unknown) {
  const hours = record(value);
  const configuredDays = Object.entries(hours).filter(([, dayValue]) => {
    const textValue = String(dayValue).trim().toLowerCase();
    return textValue.length > 0 && textValue !== "closed";
  }).length;

  if (configuredDays === 0) {
    return "No open days set";
  }

  return `${configuredDays} open ${configuredDays === 1 ? "day" : "days"}`;
}

function errorMessageForGeolocation(error: GeolocationPositionError) {
  if (error.code === error.PERMISSION_DENIED) {
    return {
      title: "Location permission is blocked",
      message: "Allow location for this site in your browser settings, then try again."
    };
  }

  if (error.code === error.POSITION_UNAVAILABLE) {
    return {
      title: "GPS position is unavailable",
      message: "Turn on device location and try again."
    };
  }

  if (error.code === error.TIMEOUT) {
    return {
      title: "GPS capture timed out",
      message: "We could not get your location. Try again from your shop entrance."
    };
  }

  return {
    title: "GPS capture failed",
    message: "Try capturing the shop location again."
  };
}

export function ReviewStep({
  bootstrap,
  errors,
  launching,
  onLaunch,
  values
}: {
  bootstrap: OnboardingBootstrap;
  errors: { path: string; message: string }[];
  launching: boolean;
  onLaunch: () => void;
  values: Record<OnboardingStep, OnboardingPayload>;
}) {
  const business = values.BUSINESS;
  const branding = values.BRANDING;
  const legal = values.LEGAL;
  const location = values.LOCATION;
  const preferences = values.PREFERENCES;
  const hasLocationCoordinates =
    numberValue(location.latitude) !== undefined && numberValue(location.longitude) !== undefined;
  const storeName = text(business.storeName) || bootstrap.store.name;
  const category = text(business.category) || "Store";
  const description = text(branding.description) || text(branding.tagline) || "Ready to submit for approval review.";
  const businessType = text(business.businessType) === "unregistered" ? "Local Merchant" : text(business.businessType) || "Merchant";
  const addressLine = text(legal.addressLine) || "Address not provided";
  const cityLine = [text(legal.city), text(legal.state), text(legal.pincode)].filter(Boolean).join(", ");

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 duration-500">
      <section className="mb-6 flex min-h-[280px] flex-col overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-sm">
        <div className="aspect-[2.8/1] w-full overflow-hidden bg-slate-100 shadow-inner">
          {text(branding.bannerUrl) ? (
            <img alt="Store banner" className="h-full w-full object-cover" src={text(branding.bannerUrl)} />
          ) : (
            <div className="h-full w-full bg-gradient-to-br from-slate-100 via-emerald-50 to-cyan-50" />
          )}
        </div>

        <div className="flex flex-1 flex-col justify-between space-y-4 p-4">
          <div className="flex items-center gap-3">
            <span
              className="relative flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-100 bg-white text-xs font-black text-slate-900 shadow-md"
              style={{ backgroundColor: text(branding.primaryColor) || "#ffffff" }}
            >
              {text(branding.logoUrl) ? (
                <img alt="Store logo" className="h-full w-full object-contain bg-white p-1.5" src={text(branding.logoUrl)} />
              ) : (
                initials(storeName)
              )}
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-base font-extrabold leading-tight text-slate-950">{storeName}</h2>
                <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-600">
                  {category}
                </span>
              </div>
            </div>
          </div>

          <p className="line-clamp-3 px-1 text-[13px] font-medium leading-5 text-slate-600">{description}</p>
        </div>
      </section>
      
      <section className="overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-sm">
        <div className="border-b border-zinc-100 px-5 py-4">
          <p className="text-sm font-extrabold text-zinc-950">Profile details</p>
          <p className="mt-1 text-xs font-semibold text-zinc-500">Review everything before submitting.</p>
        </div>
        <div className="divide-y divide-zinc-100">
          <ReviewDetailRow
            badge="Ready"
            icon={<Briefcase size={16} />}
            label="Business"
            primary={`${businessType} / ${text(business.country) || "IN"}`}
            secondary={text(business.phone) || "No phone"}
          />
          <ReviewDetailRow
            badge="Ready"
            icon={<ShieldCheck size={16} />}
            label="Legal"
            primary={text(legal.legalName) || "Ready for review"}
            secondary={text(legal.contactEmail) || "No email"}
          />
          <ReviewDetailRow
            badge={hasLocationCoordinates ? "GPS saved" : "Missing"}
            icon={<MapPin size={16} />}
            label="Location"
            primary={addressLine}
            secondary={cityLine || "City not provided"}
          />
          <ReviewDetailRow
            badge="Set"
            icon={<Clock size={16} />}
            label="Operations"
            primary="Business hours configured"
            secondary={businessHoursSummary(preferences.businessHours)}
          />
        </div>
      </section>

      {errors.length > 0 && (
        <div className="mt-8 rounded-xl border border-red-200 bg-red-50 p-4" role="alert">
          <p className="text-sm font-semibold text-red-900">{errors[0].message}</p>
        </div>
      )}

      <button
        className="mt-8 flex h-12 w-full items-center justify-center gap-3 rounded-xl bg-zinc-950 px-6 text-sm font-bold text-white shadow-sm transition-colors hover:bg-zinc-900 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
        disabled={launching}
        onClick={onLaunch}
        type="button"
      >
        {launching ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}
        {launching ? "Submitting" : "Submit Profile for Review"}
      </button>
    </div>
  );
}

function ReviewDetailRow({
  badge,
  icon,
  label,
  primary,
  secondary
}: {
  badge: string;
  icon: ReactNode;
  label: string;
  primary: string;
  secondary: string;
}) {
  const warning = badge === "Missing";

  return (
    <div className="flex gap-3 px-5 py-4">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-2xl bg-zinc-950 text-white shadow-sm">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-bold uppercase text-zinc-400">{label}</p>
          <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-extrabold ${warning ? "bg-amber-50 text-amber-700" : "bg-zinc-100 text-zinc-700"}`}>
            {badge}
          </span>
        </div>
        <p className="mt-1.5 break-words text-sm font-extrabold text-zinc-950">{primary}</p>
        <p className="mt-0.5 break-words text-sm font-semibold leading-relaxed text-zinc-500">{secondary}</p>
      </div>
    </div>
  );
}
