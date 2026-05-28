"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle2,
  ClipboardPaste,
  Copy,
  Crosshair,
  ExternalLink,
  Loader2,
  MapPin,
  Navigation,
  RefreshCcw,
  Save,
  ShieldCheck
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useToast } from "@/components/toast/toast-context";
import { ApiError } from "@/lib/api";
import {
  fetchMerchantStoreLocation,
  updateMerchantStoreLocation,
  type MerchantStoreLocation,
  type UpdateMerchantStoreLocationPayload
} from "@/lib/merchant-dashboard-api";
import { DashboardButton, PageTitle, Panel } from "../../components/ui/dashboard-ui";
import { cx } from "../../lib/dashboard-utils";

const LOCATION_QUERY_KEY = ["merchant", "settings", "location"] as const;

interface LocationForm {
  latitude: string;
  longitude: string;
  addressLine: string;
  city: string;
  state: string;
  pincode: string;
  accuracyMeters: number | null;
}

interface ParsedCoordinate {
  latitude: number;
  longitude: number;
}

const emptyForm: LocationForm = {
  latitude: "",
  longitude: "",
  addressLine: "",
  city: "",
  state: "",
  pincode: "",
  accuracyMeters: null
};

export function SettingsScreen() {
  const t = useTranslations("dashboard");
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<LocationForm>(emptyForm);
  const [savedForm, setSavedForm] = useState<LocationForm | null>(null);
  const [loadedSnapshot, setLoadedSnapshot] = useState<string | null>(null);
  const [mapsInput, setMapsInput] = useState("");
  const [isLocating, setIsLocating] = useState(false);

  const locationQuery = useQuery({
    queryKey: LOCATION_QUERY_KEY,
    queryFn: ({ signal }) => fetchMerchantStoreLocation({ signal })
  });

  useEffect(() => {
    if (!locationQuery.data) {
      return;
    }
    const snapshot = locationSnapshot(locationQuery.data);
    if (snapshot === loadedSnapshot) {
      return;
    }
    const nextForm = formFromLocation(locationQuery.data);
    setForm(nextForm);
    setSavedForm(nextForm);
    setLoadedSnapshot(snapshot);
  }, [loadedSnapshot, locationQuery.data]);

  const fieldState = useMemo(() => {
    const latitude = coordinateFieldState(form.latitude, -90, 90, "Latitude");
    const longitude = coordinateFieldState(form.longitude, -180, 180, "Longitude");
    const pincode = pincodeFieldError(form.pincode);
    return { latitude, longitude, pincode };
  }, [form.latitude, form.longitude, form.pincode]);

  const currentCoordinates = fieldState.latitude.value != null && fieldState.longitude.value != null
    ? { latitude: fieldState.latitude.value, longitude: fieldState.longitude.value }
    : null;
  const mapsUrl = currentCoordinates ? googleMapsUrl(currentCoordinates) : locationQuery.data?.googleMapsUrl ?? null;
  const isDirty = Boolean(savedForm && formSignature(form) !== formSignature(savedForm));
  const canSave = Boolean(
    isDirty &&
    currentCoordinates &&
    !fieldState.latitude.error &&
    !fieldState.longitude.error &&
    !fieldState.pincode
  );

  const mutation = useMutation({
    mutationFn: updateMerchantStoreLocation,
    onSuccess: (location) => {
      queryClient.setQueryData(LOCATION_QUERY_KEY, location);
      const nextForm = formFromLocation(location);
      setForm((current) => ({
        ...nextForm,
        accuracyMeters: current.accuracyMeters
      }));
      setSavedForm(nextForm);
      setLoadedSnapshot(locationSnapshot(location));
      toast.success("Store location saved.");
    },
    onError: (error) => {
      toast.error(errorMessage(error, "Store location could not be saved."));
    }
  });

  const updateField = (field: keyof LocationForm) => (value: string) => {
    setForm((current) => ({
      ...current,
      [field]: value
    }));
  };

  const handleApplyMapsInput = () => {
    const parsed = parseCoordinatesFromText(mapsInput);
    if (!parsed) {
      toast.warning("Paste a Google Maps link or coordinates like 8.712818, 77.421538.");
      return;
    }
    setForm((current) => ({
      ...current,
      latitude: formatCoordinate(parsed.latitude),
      longitude: formatCoordinate(parsed.longitude),
      accuracyMeters: null
    }));
    toast.success("Coordinates applied.");
  };

  const handlePasteFromClipboard = async () => {
    if (!navigator.clipboard?.readText) {
      toast.warning("Clipboard access is not available in this browser.");
      return;
    }
    try {
      const text = await navigator.clipboard.readText();
      setMapsInput(text);
      const parsed = parseCoordinatesFromText(text);
      if (parsed) {
        setForm((current) => ({
          ...current,
          latitude: formatCoordinate(parsed.latitude),
          longitude: formatCoordinate(parsed.longitude),
          accuracyMeters: null
        }));
        toast.success("Coordinates applied from clipboard.");
        return;
      }
      toast.warning("Clipboard did not contain usable coordinates.");
    } catch (error) {
      toast.error(errorMessage(error, "Clipboard could not be read."));
    }
  };

  const handleUseDeviceLocation = () => {
    if (!navigator.geolocation) {
      toast.warning("Device location is not available in this browser.");
      return;
    }
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const accuracy = Math.max(0, Math.round(position.coords.accuracy));
        setForm((current) => ({
          ...current,
          latitude: formatCoordinate(position.coords.latitude),
          longitude: formatCoordinate(position.coords.longitude),
          accuracyMeters: accuracy
        }));
        setIsLocating(false);
        toast.success(`Device pin captured within ${formatMeters(accuracy)}.`);
      },
      (error) => {
        setIsLocating(false);
        toast.error(geolocationErrorMessage(error));
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 15000
      }
    );
  };

  const handleReset = () => {
    if (!savedForm) {
      return;
    }
    setForm(savedForm);
    setMapsInput("");
    toast.info("Unsaved changes cleared.");
  };

  const handleCopyCoordinates = async () => {
    if (!currentCoordinates) {
      toast.warning("There are no valid coordinates to copy.");
      return;
    }
    try {
      await navigator.clipboard.writeText(`${formatCoordinate(currentCoordinates.latitude)}, ${formatCoordinate(currentCoordinates.longitude)}`);
      toast.success("Coordinates copied.");
    } catch (error) {
      toast.error(errorMessage(error, "Coordinates could not be copied."));
    }
  };

  const handleSave = () => {
    if (!currentCoordinates || fieldState.latitude.error || fieldState.longitude.error || fieldState.pincode) {
      toast.warning("Fix the highlighted location fields before saving.");
      return;
    }
    const payload: UpdateMerchantStoreLocationPayload = {
      latitude: currentCoordinates.latitude,
      longitude: currentCoordinates.longitude,
      addressLine: form.addressLine,
      city: form.city,
      state: form.state,
      pincode: form.pincode
    };
    mutation.mutate(payload);
  };

  const status = locationStatus(locationQuery.data, isDirty, mutation.isPending);

  return (
    <div className="space-y-6">
      <PageTitle
        actions={
          <>
            <DashboardButton
              disabled={isLocating || mutation.isPending}
              icon={isLocating ? Loader2 : Navigation}
              label={isLocating ? "Locating" : "Use GPS"}
              onClick={handleUseDeviceLocation}
              variant="secondary"
            />
            <DashboardButton
              disabled={!isDirty || mutation.isPending}
              icon={RefreshCcw}
              label="Reset"
              onClick={handleReset}
              variant="secondary"
            />
            <DashboardButton
              disabled={!canSave || mutation.isPending}
              icon={mutation.isPending ? Loader2 : Save}
              label={mutation.isPending ? "Saving" : "Save location"}
              onClick={handleSave}
              showLabelOnMobile
            />
          </>
        }
        eyebrow={t("settings.eyebrow")}
        title={t("settings.title")}
      />

      {locationQuery.isError ? (
        <Panel
          action={<DashboardButton icon={RefreshCcw} label="Retry" onClick={() => void locationQuery.refetch()} variant="secondary" />}
          className="border-rose-200 bg-rose-50/40"
          eyebrow="Location"
          title="Store location unavailable"
        >
          <div className="flex items-start gap-3 text-[13px] font-medium text-rose-700">
            <AlertCircle className="mt-0.5 shrink-0" size={16} />
            <p>{errorMessage(locationQuery.error, "We could not load the store location.")}</p>
          </div>
        </Panel>
      ) : (
        <Panel
          action={<PrecisionBadge status={status} />}
          eyebrow="Location"
          title={locationQuery.data?.name ? `${locationQuery.data.name} pin` : "Store pin"}
        >
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
            <div className="space-y-5">
              <div className="grid gap-3 md:grid-cols-2">
                <LocationField
                  error={fieldState.latitude.error}
                  label="Latitude"
                  onChange={updateField("latitude")}
                  placeholder="8.7128180"
                  value={form.latitude}
                />
                <LocationField
                  error={fieldState.longitude.error}
                  label="Longitude"
                  onChange={updateField("longitude")}
                  placeholder="77.4215380"
                  value={form.longitude}
                />
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <LocationField
                  label="Address"
                  onChange={updateField("addressLine")}
                  placeholder="Shop number, street, landmark"
                  value={form.addressLine}
                />
                <LocationField
                  error={fieldState.pincode}
                  label="Pincode"
                  onChange={updateField("pincode")}
                  placeholder="627001"
                  value={form.pincode}
                />
                <LocationField
                  label="City"
                  onChange={updateField("city")}
                  placeholder="Tirunelveli"
                  value={form.city}
                />
                <LocationField
                  label="State"
                  onChange={updateField("state")}
                  placeholder="Tamil Nadu"
                  value={form.state}
                />
              </div>

              <div className="rounded-xl border border-zinc-200 bg-zinc-50/50 p-3">
                <label className="block" htmlFor="merchant-google-maps-coordinate">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Google Maps URL or coordinates</span>
                  <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                    <input
                      className="min-h-10 min-w-0 flex-1 rounded-lg border border-zinc-200 bg-white px-3 text-[13px] font-normal text-zinc-950 outline-none transition placeholder:text-zinc-400 focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/5"
                      id="merchant-google-maps-coordinate"
                      onChange={(event) => setMapsInput(event.target.value)}
                      placeholder="https://maps.google.com/... or 8.712818, 77.421538"
                      value={mapsInput}
                    />
                    <div className="flex gap-2">
                      <DashboardButton icon={ClipboardPaste} label="Paste" onClick={handlePasteFromClipboard} variant="secondary" />
                      <DashboardButton icon={Crosshair} label="Apply" onClick={handleApplyMapsInput} />
                    </div>
                  </div>
                </label>
              </div>
            </div>

            <div className="space-y-4">
              <LocationPreview
                coordinates={currentCoordinates}
                isLoading={locationQuery.isLoading}
                mapsUrl={mapsUrl}
                onCopy={handleCopyCoordinates}
              />
              <PrecisionChecks
                accuracyMeters={form.accuracyMeters}
                coordinates={currentCoordinates}
                isDirty={isDirty}
                location={locationQuery.data}
              />
            </div>
          </div>
        </Panel>
      )}
    </div>
  );
}

function LocationField({
  error,
  label,
  onChange,
  placeholder,
  value
}: {
  error?: string | null;
  label: string;
  onChange: (value: string) => void;
  placeholder?: string;
  value: string;
}) {
  return (
    <label className="block min-w-0">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">{label}</span>
      <input
        aria-invalid={Boolean(error)}
        className={cx(
          "mt-1 h-10 w-full rounded-lg border bg-white px-3 text-[13px] font-normal text-zinc-950 outline-none transition placeholder:text-zinc-400 focus:ring-2 focus:ring-zinc-950/5",
          error ? "border-rose-300 focus:border-rose-500" : "border-zinc-200 focus:border-zinc-950"
        )}
        inputMode={label === "Latitude" || label === "Longitude" ? "decimal" : "text"}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        value={value}
      />
      {error && <span className="mt-1 block text-[10px] font-medium leading-snug text-rose-600">{error}</span>}
    </label>
  );
}

function PrecisionBadge({ status }: { status: "clean" | "dirty" | "missing" | "saving" }) {
  const icon =
    status === "clean" ? CheckCircle2 :
      status === "saving" ? Loader2 :
        status === "missing" ? AlertCircle :
          ShieldCheck;
  const Icon = icon;
  const label =
    status === "clean" ? "Saved" :
      status === "saving" ? "Saving" :
        status === "missing" ? "Pin required" :
          "Unsaved";

  return (
    <span className={cx(
      "inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-medium",
      status === "clean" && "border-emerald-200 bg-emerald-50 text-emerald-800",
      status === "saving" && "border-zinc-200 bg-zinc-50 text-zinc-600",
      status === "missing" && "border-amber-200 bg-amber-50 text-amber-800",
      status === "dirty" && "border-sky-200 bg-sky-50 text-sky-800"
    )}>
      <Icon className={status === "saving" ? "animate-spin" : undefined} size={13} />
      {label}
    </span>
  );
}

function LocationPreview({
  coordinates,
  isLoading,
  mapsUrl,
  onCopy
}: {
  coordinates: ParsedCoordinate | null;
  isLoading: boolean;
  mapsUrl: string | null;
  onCopy: () => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
      <div className="relative min-h-[260px] bg-zinc-50">
        <div
          aria-hidden
          className="absolute inset-0 opacity-60"
          style={{
            backgroundImage:
              "linear-gradient(rgba(24,24,27,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(24,24,27,0.07) 1px, transparent 1px)",
            backgroundSize: "28px 28px"
          }}
        />
        <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-zinc-300/80" />
        <div className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-zinc-300/80" />
        <div className="absolute inset-0 flex items-center justify-center p-6">
          <div className="max-w-full rounded-xl border border-zinc-200 bg-white/95 p-4 text-center shadow-sm backdrop-blur">
            <span className="mx-auto flex size-10 items-center justify-center rounded-xl bg-zinc-950 text-white">
              {isLoading ? <Loader2 className="animate-spin" size={16} /> : <MapPin size={17} />}
            </span>
            <p className="mt-3 text-sm font-semibold tracking-tight text-zinc-950">
              {coordinates ? "Exact store pin" : "No saved pin"}
            </p>
            <p className="mt-1 break-words font-mono text-[12px] font-normal tracking-normal text-zinc-500">
              {coordinates ? `${formatCoordinate(coordinates.latitude)}, ${formatCoordinate(coordinates.longitude)}` : "Latitude and longitude required"}
            </p>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200 p-3">
        <button
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 text-[12px] font-medium text-zinc-700 shadow-sm transition hover:border-zinc-300 hover:text-zinc-950 disabled:pointer-events-none disabled:opacity-50"
          disabled={!coordinates}
          onClick={onCopy}
          type="button"
        >
          <Copy size={13} />
          Copy
        </button>
        {mapsUrl ? (
          <a
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 text-[12px] font-medium text-zinc-700 shadow-sm transition hover:border-zinc-300 hover:text-zinc-950"
            href={mapsUrl}
            rel="noreferrer"
            target="_blank"
          >
            <ExternalLink size={13} />
            Open Maps
          </a>
        ) : (
          <span className="text-[12px] font-medium text-zinc-400">Maps link unavailable</span>
        )}
      </div>
    </div>
  );
}

function PrecisionChecks({
  accuracyMeters,
  coordinates,
  isDirty,
  location
}: {
  accuracyMeters: number | null;
  coordinates: ParsedCoordinate | null;
  isDirty: boolean;
  location?: MerchantStoreLocation;
}) {
  const rows = [
    {
      label: "Coordinate precision",
      value: coordinates ? "7 decimal places" : "Missing",
      ok: Boolean(coordinates)
    },
    {
      label: "Device accuracy",
      value: accuracyMeters == null ? "Not captured" : formatMeters(accuracyMeters),
      ok: accuracyMeters != null && accuracyMeters <= 50
    },
    {
      label: "Storefront sync",
      value: isDirty ? "Save pending" : "Current",
      ok: !isDirty && Boolean(coordinates)
    },
    {
      label: "Last saved",
      value: location?.updatedAt ? formatSavedAt(location.updatedAt) : "Never",
      ok: Boolean(location?.updatedAt)
    }
  ];

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-3">
      <div className="divide-y divide-zinc-100">
        {rows.map((row) => (
          <div className="flex min-w-0 items-center justify-between gap-3 py-3 first:pt-0 last:pb-0" key={row.label}>
            <div className="min-w-0">
              <p className="truncate text-[12px] font-semibold text-zinc-800">{row.label}</p>
              <p className="mt-0.5 truncate text-[11px] font-normal text-zinc-500">{row.value}</p>
            </div>
            <span className={cx(
              "flex size-7 shrink-0 items-center justify-center rounded-lg border",
              row.ok ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-zinc-200 bg-zinc-50 text-zinc-400"
            )}>
              {row.ok ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function formFromLocation(location: MerchantStoreLocation): LocationForm {
  return {
    latitude: location.latitude == null ? "" : formatCoordinate(location.latitude),
    longitude: location.longitude == null ? "" : formatCoordinate(location.longitude),
    addressLine: location.addressLine ?? "",
    city: location.city ?? "",
    state: location.state ?? "",
    pincode: location.pincode ?? "",
    accuracyMeters: null
  };
}

function formSignature(form: LocationForm) {
  return [
    normalizedCoordinateText(form.latitude),
    normalizedCoordinateText(form.longitude),
    form.addressLine.trim(),
    form.city.trim(),
    form.state.trim(),
    form.pincode.trim()
  ].join("|");
}

function locationSnapshot(location: MerchantStoreLocation) {
  return [
    location.id,
    location.updatedAt,
    location.latitude ?? "",
    location.longitude ?? "",
    location.addressLine ?? "",
    location.city ?? "",
    location.state ?? "",
    location.pincode ?? ""
  ].join("|");
}

function coordinateFieldState(value: string, min: number, max: number, label: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return { error: `${label} is required.`, value: null };
  }
  if (!/^-?\d{1,3}(?:\.\d{1,7})?$/.test(trimmed)) {
    return { error: "Use a signed decimal with up to 7 digits after the decimal.", value: null };
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    return { error: `${label} must be between ${min} and ${max}.`, value: null };
  }
  return { error: null, value: parsed };
}

function pincodeFieldError(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return /^\d{6}$/.test(trimmed) ? null : "Use a 6-digit pincode.";
}

function parseCoordinatesFromText(value: string): ParsedCoordinate | null {
  const text = safeDecode(value.trim());
  if (!text) {
    return null;
  }

  const patterns = [
    /!3d(-?\d{1,2}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/i,
    /@(-?\d{1,2}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)/i,
    /[?&](?:q|query|ll|center)=(-?\d{1,2}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)/i,
    /(?:^|[^\d.-])(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)(?:$|[^\d.])/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) {
      continue;
    }
    const latitude = Number(match[1]);
    const longitude = Number(match[2]);
    if (isValidCoordinate(latitude, longitude)) {
      return { latitude, longitude };
    }
  }

  return null;
}

function isValidCoordinate(latitude: number, longitude: number) {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function formatCoordinate(value: number) {
  return value.toFixed(7);
}

function normalizedCoordinateText(value: string) {
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? formatCoordinate(parsed) : value.trim();
}

function googleMapsUrl(coordinates: ParsedCoordinate) {
  return `https://www.google.com/maps/search/?api=1&query=${formatCoordinate(coordinates.latitude)},${formatCoordinate(coordinates.longitude)}`;
}

function formatMeters(value: number) {
  return `${Math.max(0, Math.round(value))} m`;
}

function formatSavedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Saved";
  }
  return new Intl.DateTimeFormat(undefined, {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short"
  }).format(date);
}

function locationStatus(
  location: MerchantStoreLocation | undefined,
  isDirty: boolean,
  isSaving: boolean
): "clean" | "dirty" | "missing" | "saving" {
  if (isSaving) {
    return "saving";
  }
  if (isDirty) {
    return "dirty";
  }
  if (location?.latitude == null || location.longitude == null) {
    return "missing";
  }
  return "clean";
}

function geolocationErrorMessage(error: GeolocationPositionError) {
  if (error.code === error.PERMISSION_DENIED) {
    return "Location permission was denied.";
  }
  if (error.code === error.POSITION_UNAVAILABLE) {
    return "Device location is currently unavailable.";
  }
  if (error.code === error.TIMEOUT) {
    return "Device location timed out. Try again near the storefront entrance.";
  }
  return "Device location could not be captured.";
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    return error.message || fallback;
  }
  return error instanceof Error && error.message ? error.message : fallback;
}
