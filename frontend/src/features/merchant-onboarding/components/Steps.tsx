/* eslint-disable @next/next/no-img-element */
import { useCallback, useEffect, useState } from "react";
import { OnboardingBootstrap, OnboardingPayload, OnboardingRules, OnboardingStep } from "@/lib/merchant-onboarding-api";
import { UploadState } from "../hooks/useOnboarding";
import {
  DEFAULT_BUSINESS_HOURS,
  coordinateText,
  normalizeBusinessHours,
  numberValue,
  record,
  roundCoordinate,
  text
} from "../onboarding-utils";
import { Input } from "./ui/Input";
import { Select } from "./ui/Select";
import { UploadZone } from "./ui/UploadZone";
import { AlertTriangle, Loader2, LocateFixed, MapPin, RefreshCw, Send, Briefcase, ShieldCheck, Clock } from "lucide-react";

const GPS_ACCURACY_THRESHOLD_METERS = 200;
const GPS_TIMEOUT_MS = 15000;

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
    ? "Mobile browsers only show GPS permission prompts on HTTPS pages. Open the HTTPS dev URL or the production HTTPS site, then tap Grant GPS Permission."
    : "This page must be opened on HTTPS or localhost before the browser can ask for GPS permission.";
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
        onChange={(event) => updateValue("BUSINESS", "category", event.target.value)}
        options={rules.options.categories}
        value={text(values.category)}
      />
      <Select
        dataField="businessType"
        error={errors.businessType}
        label="Business Type"
        onChange={(event) => updateValue("BUSINESS", "businessType", event.target.value)}
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
  const accuracy = numberValue(values.accuracy);
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
          ? "This mobile browser is not exposing GPS to the page. Check browser location permissions and use HTTPS."
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
            title: "GPS signal is too weak",
            message: `Current accuracy is about ${Math.round(nextAccuracy)}m. Capture again when the signal is within ${GPS_ACCURACY_THRESHOLD_METERS}m.`
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
    <div className="animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 gap-4">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-zinc-950 text-white shadow-sm">
              <MapPin size={22} />
            </div>
            <div className="min-w-0">
              <h3 className="text-lg font-semibold tracking-tight text-zinc-900">Shop GPS Location</h3>
              <p className="mt-1 text-sm font-medium leading-relaxed text-zinc-500">
                {mobile
                  ? "Tap Get Current Location on your phone to capture the exact storefront position."
                  : "Use GPS to capture the exact storefront position for local delivery and review."}
              </p>
            </div>
          </div>
          <button
            className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-zinc-950 px-4 text-[13px] font-medium text-white shadow-sm transition hover:bg-zinc-900 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none"
            data-field="latitude"
            disabled={captureState === "capturing"}
            onClick={captureLocation}
            type="button"
          >
            {captureState === "capturing" ? <Loader2 className="animate-spin" size={15} /> : hasCoordinates ? <RefreshCw size={15} /> : <LocateFixed size={15} />}
            {captureState === "capturing" ? "Capturing" : "Get Current Location"}
          </button>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <CoordinateTile label="Latitude" value={coordinateText(values.latitude)} />
          <CoordinateTile label="Longitude" value={coordinateText(values.longitude)} />
          <CoordinateTile label="Accuracy" value={accuracy === undefined ? "--" : `${Math.round(accuracy)}m`} />
        </div>

        {(captureError || validationError) && (
          <div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4" role="alert">
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

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="grid gap-8">
        <div>
          <h3 className="text-sm font-semibold text-zinc-900 tracking-tight mb-4">Business Hours</h3>
          <div className="grid gap-3">
            {Object.entries(businessHours).map(([day, value]) => (
              <label
                className="grid grid-cols-[100px_minmax(0,1fr)] items-center gap-4 text-sm font-semibold capitalize text-zinc-600"
                key={day}
              >
                {day}
                <div className="relative">
                  <input
                    value={String(value)}
                    onChange={(event) =>
                      updateValue("PREFERENCES", "businessHours", {
                        ...businessHours,
                        [day]: event.target.value
                      })
                    }
                    className={`
                      flex h-11 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm
                      transition-all duration-300
                      focus:border-zinc-900 focus:outline-none focus:ring-4 focus:ring-zinc-900/10 hover:border-zinc-300
                    `}
                  />
                </div>
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function CoordinateTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">{label}</p>
      <p className="mt-1 font-mono text-[13px] font-medium text-zinc-900">{value}</p>
    </div>
  );
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
      message: "Enable location permission for this site in your browser or OS settings, then return and capture again."
    };
  }

  if (error.code === error.POSITION_UNAVAILABLE) {
    return {
      title: "GPS position is unavailable",
      message: "Check device location services and try again from a place with a clearer GPS signal."
    };
  }

  if (error.code === error.TIMEOUT) {
    return {
      title: "GPS capture timed out",
      message: "Try again near a window or outdoors so the device can get a fresh location fix."
    };
  }

  return {
    title: "GPS capture failed",
    message: error.message || "Try capturing the shop location again."
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

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="relative overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm mb-8">
        <div className="h-32 w-full bg-zinc-100 sm:h-40">
          {text(branding.bannerUrl) ? (
            <img alt="Store Banner" className="h-full w-full object-cover" src={text(branding.bannerUrl)} />
          ) : (
            <div className="h-full w-full bg-gradient-to-r from-zinc-200 to-zinc-100" />
          )}
        </div>
        
        <div className="relative px-6 pb-6">
          <div className="-mt-12 mb-4 flex items-end sm:-mt-16 sm:mb-5">
            <div
              className="flex size-24 sm:size-32 shrink-0 items-center justify-center overflow-hidden rounded-2xl border-4 border-white bg-zinc-950 text-2xl sm:text-3xl font-semibold text-white shadow-sm"
              style={{ backgroundColor: text(branding.primaryColor) || "#000000" }}
            >
              {text(branding.logoUrl) ? (
                <img alt="Store Logo" className="h-full w-full object-contain bg-white p-2" src={text(branding.logoUrl)} />
              ) : (
                initials(text(business.storeName))
              )}
            </div>
          </div>
          
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">{text(business.category) || "Store"}</p>
            <h2 className="mt-1.5 truncate text-2xl font-semibold tracking-tight text-zinc-950">{text(business.storeName) || bootstrap.store.name}</h2>
            <p className="mt-2 text-[13px] font-normal leading-relaxed text-zinc-500 max-w-2xl">{text(branding.description) || text(branding.tagline) || "Ready to submit for approval review."}</p>
          </div>
        </div>
      </div>
      
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 mb-2.5 flex items-center gap-2">
            <Briefcase size={14} className="text-zinc-400" />
            Business Details
          </p>
          <p className="text-sm font-semibold text-zinc-900">{text(business.businessType) === "unregistered" ? "Local Merchant" : text(business.businessType) || "Merchant"} · {text(business.country) || "IN"}</p>
          <p className="mt-1 text-sm font-medium text-zinc-500">{text(business.phone) || "No phone"}</p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 mb-2.5 flex items-center gap-2">
            <ShieldCheck size={14} className="text-zinc-400" />
            Legal & Contact
          </p>
          <p className="text-sm font-semibold text-zinc-900">{text(legal.legalName) || "Ready for review"}</p>
          <p className="mt-1 text-sm font-medium text-zinc-500">{text(legal.contactEmail) || "No email"}</p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 mb-2.5 flex items-center gap-2">
            <MapPin size={14} className="text-zinc-400" />
            Location & Address
          </p>
          <p className="text-sm font-semibold text-zinc-900">{text(legal.addressLine) || "Address not provided"}</p>
          <p className="mt-1 text-sm font-medium text-zinc-500">
            {text(legal.city) ? `${text(legal.city)}, ` : ""}
            {text(legal.state) ? `${text(legal.state)} ` : ""}
            {text(legal.pincode) || ""}
          </p>
          {hasLocationCoordinates && (
            <p className="mt-3 text-xs font-medium text-zinc-500 font-mono bg-zinc-50 px-2 py-1.5 rounded-md inline-block border border-zinc-100">
              {coordinateText(location.latitude)}, {coordinateText(location.longitude)}
            </p>
          )}
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 mb-2.5 flex items-center gap-2">
            <Clock size={14} className="text-zinc-400" />
            Operations
          </p>
          <p className="text-sm font-semibold text-zinc-900">Business hours configured</p>
          <p className="mt-1 text-sm font-medium text-zinc-500">{businessHoursSummary(preferences.businessHours)}</p>
        </div>
      </div>

      {errors.length > 0 && (
        <div className="mt-8 rounded-xl border border-red-200 bg-red-50 p-4" role="alert">
          <p className="text-sm font-semibold text-red-900">{errors[0].message}</p>
        </div>
      )}

      <button
        className="mt-8 flex h-12 w-full items-center justify-center gap-3 rounded-xl bg-zinc-950 px-6 text-[13px] font-medium text-white shadow-sm transition-colors hover:bg-zinc-900 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
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
