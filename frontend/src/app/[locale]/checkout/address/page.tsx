"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { LatLngExpression, Map as LeafletMap, Marker as LeafletMarker } from "leaflet";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Loader2,
  LocateFixed,
  MapPin,
  Search,
  X
} from "lucide-react";
import { Link, useRouter } from "@/i18n/navigation";
import {
  type AddressDraft,
  type DeliveryPoint,
  type ReverseGeocodeResult,
  addressDraftFromNominatim,
  emptyAddressDraft,
  normalizeDeliveryPoint,
  persistAddressDraft,
  pointFromDraft,
  readAddressDraft,
  safeNextPath,
  withoutEmpty
} from "@/features/checkout/address-draft";

const DEFAULT_POINT: DeliveryPoint = { latitude: 8.7139, longitude: 77.7567 };
const SEARCH_DEBOUNCE_MS = 350;
const NOMINATIM_BASE_URL = "https://nominatim.openstreetmap.org";

type LocationState = "idle" | "loading" | "resolved" | "denied" | "error" | "unsupported";
type SearchState = "idle" | "loading" | "ready" | "error";

interface PlaceSearchResult extends ReverseGeocodeResult {
  place_id: number;
  lat: string;
  lon: string;
  name?: string;
}

export default function CheckoutAddressPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = safeNextPath(searchParams.get("next"));
  const detailsPath = useMemo(
    () => `/checkout/address/details?next=${encodeURIComponent(nextPath)}`,
    [nextPath]
  );

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markerRef = useRef<LeafletMarker | null>(null);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);

  const [draft, setDraft] = useState<AddressDraft>(() => emptyAddressDraft());
  const [draftHydrated, setDraftHydrated] = useState(false);
  const [locationState, setLocationState] = useState<LocationState>("idle");
  const [locationAccuracy, setLocationAccuracy] = useState<number | null>(null);
  const [selectedPoint, setSelectedPoint] = useState<DeliveryPoint | null>(null);
  const [selectedLabel, setSelectedLabel] = useState("Choose a delivery pin");
  const [mapReady, setMapReady] = useState(false);
  const [pinRequired, setPinRequired] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchState, setSearchState] = useState<SearchState>("idle");
  const [searchResults, setSearchResults] = useState<PlaceSearchResult[]>([]);

  const hasSelectedPin = Boolean(selectedPoint);
  const pinSummary = useMemo(() => {
    if (!selectedPoint) {
      return "Search a place, use GPS, or tap the map.";
    }
    return `${selectedPoint.latitude.toFixed(6)}, ${selectedPoint.longitude.toFixed(6)}`;
  }, [selectedPoint]);

  const moveMapPin = useCallback((point: DeliveryPoint, options: { animate?: boolean } = {}) => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!L || !map) {
      return;
    }

    const latLng: LatLngExpression = [point.latitude, point.longitude];
    if (!markerRef.current) {
      markerRef.current = L.marker(latLng, {
        icon: L.divIcon({
          className: "",
          html: '<span class="checkout-map-pin"><span></span></span>',
          iconAnchor: [18, 36],
          iconSize: [36, 36]
        }),
        keyboard: false
      }).addTo(map);
    } else {
      markerRef.current.setLatLng(latLng);
    }

    const zoom = Math.max(map.getZoom(), 16);
    if (options.animate) {
      map.flyTo(latLng, zoom, { animate: true, duration: 0.55 });
    } else {
      map.setView(latLng, zoom);
    }
  }, []);

  const applyPoint = useCallback(async (
    point: DeliveryPoint,
    options: {
      accuracy?: number | null;
      label?: string;
      patch?: Partial<AddressDraft>;
      reverseLookup?: boolean;
    } = {}
  ) => {
    const normalizedPoint = normalizeDeliveryPoint(point);
    if (!normalizedPoint) {
      setLocationState("error");
      return;
    }

    setSelectedPoint(normalizedPoint);
    setPinRequired(false);
    setLocationAccuracy(options.accuracy ?? null);
    setSelectedLabel(options.label ?? "Selected delivery location");
    setLocationState("resolved");
    moveMapPin(normalizedPoint, { animate: true });

    setDraft((current) => ({
      ...current,
      ...withoutEmpty(options.patch ?? {}),
      latitude: normalizedPoint.latitude,
      longitude: normalizedPoint.longitude
    }));

    if (options.reverseLookup === false) {
      return;
    }

    try {
      const result = await reverseGeocode(normalizedPoint.latitude, normalizedPoint.longitude);
      setSelectedLabel(result.display_name?.split(",").slice(0, 3).join(", ") || "Selected delivery location");
      setDraft((current) => ({
        ...current,
        ...withoutEmpty(addressDraftFromNominatim()),
        latitude: normalizedPoint.latitude,
        longitude: normalizedPoint.longitude
      }));
    } catch {
      // A selected map pin is still usable even when reverse geocoding is unavailable.
    }
  }, [moveMapPin]);

  useEffect(() => {
    const savedDraft = readAddressDraft();
    if (!savedDraft) {
      setDraftHydrated(true);
      return;
    }

    setDraft((current) => ({ ...current, ...savedDraft }));
    const savedPoint = pointFromDraft(savedDraft);
    if (savedPoint) {
      setSelectedPoint(savedPoint);
      setSelectedLabel("Draft delivery location");
    }
    setDraftHydrated(true);
  }, []);

  useEffect(() => {
    if (!draftHydrated) {
      return;
    }
    persistAddressDraft(draft);
  }, [draft, draftHydrated]);

  useEffect(() => {
    let disposed = false;

    async function setupMap() {
      const L = await import("leaflet");
      if (disposed || !mapContainerRef.current || mapRef.current) {
        return;
      }

      leafletRef.current = L;
      const initialPoint = selectedPoint ?? pointFromDraft(draft) ?? DEFAULT_POINT;
      const map = L.map(mapContainerRef.current, {
        attributionControl: false,
        center: [initialPoint.latitude, initialPoint.longitude],
        zoom: selectedPoint ? 16 : 13,
        zoomControl: false
      });
      mapRef.current = map;

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19
      }).addTo(map);
      L.control.attribution({ prefix: false, position: "bottomleft" }).addTo(map);

      map.on("click", (event) => {
        void applyPoint(
          { latitude: event.latlng.lat, longitude: event.latlng.lng },
          { label: "Selected on map" }
        );
      });

      if (selectedPoint || pointFromDraft(draft)) {
        moveMapPin(initialPoint);
      }

      window.setTimeout(() => map.invalidateSize(), 0);
      setMapReady(true);
    }

    void setupMap();

    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
      leafletRef.current = null;
    };
    // Map setup intentionally runs once; map interactions sync through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const query = searchQuery.trim();
    if (query.length < 3) {
      setSearchResults([]);
      setSearchState("idle");
      if (["error", "denied", "unsupported"].includes(locationState)) {
        setLocationState("idle");
      }
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSearchState("loading");
      searchPlaces(query, controller.signal)
        .then((results) => {
          setSearchResults(results);
          setSearchState("ready");
        })
        .catch((error) => {
          if (isAbortError(error)) {
            return;
          }
          setSearchResults([]);
          setSearchState("error");
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [searchQuery, locationState]);

  async function detectLocation() {
    if (typeof window === "undefined" || !navigator?.geolocation) {
      setLocationState("unsupported");
      return;
    }

    setLocationState("loading");

    try {
      // Fast-fail if permissions are already denied, skipping the long timeout
      if (navigator.permissions && navigator.permissions.query) {
        try {
          const permission = await navigator.permissions.query({ name: "geolocation" });
          if (permission.state === "denied") {
            setLocationState("denied");
            return;
          }
        } catch {
          // Ignore permission API errors on unsupported browsers (e.g. Safari)
        }
      }

      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          maximumAge: 10000,
          timeout: 10000 // 10 seconds max wait for FAANG responsiveness
        });
      });

      await applyPoint(
        {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude
        },
        {
          accuracy: Math.round(position.coords.accuracy),
          label: "Current location"
        }
      );
    } catch (error) {
      console.warn("GPS Detection Failed:", error);
      const err = error as GeolocationPositionError;
      if (err.code === 1 /* PERMISSION_DENIED */) {
        setLocationState("denied");
      } else if (err.code === 2 /* POSITION_UNAVAILABLE */) {
        setLocationState("error");
      } else if (err.code === 3 /* TIMEOUT */) {
        setLocationState("error");
      } else {
        setLocationState("error");
      }
    }
  }

  async function selectSearchResult(result: PlaceSearchResult) {
    const point = {
      latitude: Number(result.lat),
      longitude: Number(result.lon)
    };
    if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) {
      return;
    }

    setSearchQuery(placeTitle(result));
    setSearchResults([]);
    setLocationState("idle");
    await applyPoint(point, {
      label: placeTitle(result),
      patch: addressDraftFromNominatim(),
      reverseLookup: false
    });
  }

  function continueToDetails() {
    if (!selectedPoint) {
      setPinRequired(true);
      return;
    }
    persistAddressDraft(draft);
    router.push(detailsPath);
  }

  return (
    <AddressShell>
      <div className="mb-6 flex items-center">
        <Link className="group inline-flex items-center gap-2 text-[15px] font-bold text-black transition-colors" href="/cart">
          <span className="flex size-8 items-center justify-center rounded-full bg-zinc-100 text-black transition-transform group-hover:-translate-x-1">
            <ArrowLeft size={16} />
          </span>
          Back to cart
        </Link>
      </div>

      <section className="mx-auto flex w-full max-w-4xl flex-1 flex-col relative pb-24 sm:pb-0">
        <div className="relative flex-1 min-h-[50vh] overflow-hidden rounded-[32px] border border-zinc-200/60 bg-zinc-50 shadow-[0_10px_30px_-10px_rgba(0,0,0,0.05)] ring-1 ring-black/5">
          {/* Map Container */}
          <div className="absolute inset-0 h-full w-full bg-zinc-100">
            <div ref={mapContainerRef} className="checkout-address-map absolute inset-0 z-0" />
            {!mapReady ? (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-zinc-50/80 backdrop-blur-md text-sm font-medium text-zinc-500">
                <Loader2 className="size-6 animate-spin text-black" />
                <span className="animate-pulse">Loading interactive map...</span>
              </div>
            ) : null}

            {/* Floating Search Bar */}
            <div className="absolute left-4 right-4 top-4 z-[1100] sm:left-6 sm:right-6 max-w-2xl mx-auto">
              <div className="group relative flex h-14 items-center gap-3 rounded-2xl border border-zinc-200/70 bg-white/90 px-4 shadow-lg backdrop-blur-xl transition-all focus-within:border-zinc-400 focus-within:bg-white focus-within:shadow-xl focus-within:ring-1 focus-within:ring-zinc-300">
                <Search className="size-5 shrink-0 text-zinc-400 transition-colors group-focus-within:text-black" />
                <input
                  aria-label="Search delivery location"
                  className="min-w-0 flex-1 bg-transparent text-[15px] font-medium text-black outline-none placeholder:text-zinc-400"
                  onChange={(event) => {
                    setSearchQuery(event.target.value);
                    setPinRequired(false);
                  }}
                  placeholder="Search area, street, shop, or landmark"
                  value={searchQuery}
                />
                {searchQuery ? (
                  <button
                    aria-label="Clear search"
                    className="flex size-8 items-center justify-center rounded-full bg-zinc-100 text-zinc-500 transition-colors hover:bg-zinc-200 hover:text-black"
                    onClick={() => {
                      setSearchQuery("");
                      setSearchResults([]);
                    }}
                    type="button"
                  >
                    <X size={14} />
                  </button>
                ) : null}
              </div>

              {/* Global Error Banner (GPS errors) */}
              {["error", "denied", "unsupported"].includes(locationState) && !hasSelectedPin && (
                <div className="absolute left-0 right-0 top-16 animate-slide-down">
                  <div className="flex items-center gap-3 rounded-2xl border border-red-200/50 bg-white/95 px-4 py-3 text-sm font-semibold text-red-700 shadow-xl backdrop-blur-xl">
                    <X className="size-5 shrink-0" />
                    <span>
                      {locationState === "denied"
                        ? "Location access denied. Enable it in settings or search manually."
                        : locationState === "unsupported"
                          ? "Location not supported by this browser."
                          : "Could not fetch location. Please search manually or tap map."}
                    </span>
                  </div>
                </div>
              )}

              {/* Search Results Dropdown */}
              {searchQuery.trim().length >= 3 ? (
                <div className="absolute left-0 right-0 top-16 max-h-[400px] overflow-y-auto rounded-2xl border border-zinc-200/50 bg-white/95 p-2 shadow-xl backdrop-blur-xl animate-slide-down custom-scrollbar">
                  {searchState === "loading" ? (
                    <div className="flex items-center justify-center gap-3 py-8 text-sm font-medium text-zinc-500">
                      <Loader2 className="size-5 animate-spin" />
                      Searching places...
                    </div>
                  ) : searchState === "error" ? (
                    <div className="p-4 text-center text-sm font-medium text-amber-700">
                      Search unavailable. Please use the map directly.
                    </div>
                  ) : searchResults.length ? (
                    <div className="flex flex-col gap-1">
                      {searchResults.map((result) => (
                        <button
                          className="group flex w-full items-start gap-4 rounded-xl px-4 py-3 text-left transition-all hover:bg-zinc-100/80 active:scale-[0.98]"
                          key={result.place_id}
                          onClick={() => void selectSearchResult(result)}
                          type="button"
                        >
                          <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-400 transition-colors group-hover:bg-white group-hover:text-black group-hover:shadow-sm">
                            <MapPin size={18} />
                          </span>
                          <span className="flex min-w-0 flex-1 flex-col justify-center">
                            <span className="truncate text-[15px] font-semibold text-black">{placeTitle(result)}</span>
                            <span className="mt-1 line-clamp-1 text-[13px] font-medium text-zinc-500">
                              {result.display_name}
                            </span>
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="p-6 text-center text-sm font-medium text-zinc-500">
                      No matching places found. Try a nearby landmark.
                    </div>
                  )}
                </div>
              ) : null}
            </div>

            {/* GPS Button */}
            <button
              className={`absolute right-4 z-[900] flex size-12 items-center justify-center rounded-full border border-white/60 bg-white/90 text-black shadow-lg backdrop-blur-xl transition-all hover:scale-105 hover:bg-white disabled:opacity-50 sm:right-6 ${
                hasSelectedPin ? "bottom-32 sm:bottom-36" : "bottom-6"
              }`}
              disabled={locationState === "loading"}
              onClick={() => void detectLocation()}
              type="button"
              title="Use my current location"
            >
              {locationState === "loading" ? <Loader2 className="size-5 animate-spin" /> : <LocateFixed size={20} />}
            </button>

            {/* Bottom Floating Panel (Address summary only) - Hidden until a pin is selected */}
            {hasSelectedPin && (
              <div className="absolute bottom-4 left-4 right-4 z-[450] sm:left-6 sm:right-6 max-w-2xl mx-auto animate-slide-up">
                <div className="overflow-hidden rounded-3xl border border-white/60 bg-white/90 shadow-[0_16px_32px_-10px_rgba(0,0,0,0.15)] backdrop-blur-2xl">
                  <div className="p-4 sm:p-5">
                    <div className="flex items-start gap-4">
                      <div className="relative flex size-12 shrink-0 items-center justify-center rounded-full bg-black text-white transition-colors duration-500">
                        <div className="absolute inset-0 rounded-full bg-black animate-pulse opacity-20"></div>
                        <MapPin size={22} className="relative z-10" />
                      </div>
                      <div className="min-w-0 flex-1 pt-0.5">
                        <h3 className="truncate text-lg font-bold tracking-tight text-black">
                          {selectedLabel}
                        </h3>
                        <p className="mt-1 truncate text-sm font-medium text-zinc-500">
                          {pinSummary}
                        </p>
                      </div>
                    </div>

                    <LocationHint state={locationState} accuracy={locationAccuracy} />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Fixed Footer for action buttons */}
        <div className="fixed bottom-0 left-0 right-0 z-[500] border-t border-zinc-200 bg-white p-4 pb-6 sm:static sm:mt-6 sm:border-0 sm:bg-transparent sm:p-0 sm:pb-0">
          <div className="mx-auto w-full max-w-4xl">
            {pinRequired && !hasSelectedPin ? (
              <div className="mb-4 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50/80 px-4 py-3 text-sm font-semibold text-red-700">
                <X className="size-4 shrink-0" />
                Please select a location on the map first.
              </div>
            ) : null}

            {hasSelectedPin ? (
              <button
                className="group relative flex h-14 w-full items-center justify-center gap-2 overflow-hidden rounded-2xl bg-black text-[15px] font-bold text-white shadow-lg transition-all hover:bg-zinc-900 active:scale-[0.98]"
                onClick={continueToDetails}
                type="button"
              >
                <div className="absolute inset-0 flex h-full w-full justify-center [transform:skew(-12deg)_translateX(-100%)] group-hover:duration-1000 group-hover:[transform:skew(-12deg)_translateX(100%)]">
                  <div className="relative h-full w-8 bg-white/20" />
                </div>
                <span className="relative z-10">Confirm Location</span>
                <ArrowRight className="relative z-10 size-5 transition-transform group-hover:translate-x-1" />
              </button>
            ) : (
              <div className="flex h-14 w-full items-center justify-center rounded-2xl bg-zinc-100 text-[15px] font-bold text-zinc-400">
                Search or tap map to select location
              </div>
            )}
          </div>
        </div>
      </section>
    </AddressShell>
  );
}

function AddressShell({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-[100dvh] flex-col bg-white px-4 pt-6 font-sans sm:px-6 lg:px-8" id="main-content">
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col">
        {children}
      </div>
    </main>
  );
}

function LocationHint({ state, accuracy }: { state: LocationState; accuracy: number | null }) {
  if (state === "idle") {
    return null;
  }

  const copy: Record<LocationState, string> = {
    idle: "",
    loading: "Getting your precise location...",
    resolved: accuracy
      ? `Pin captured within about ${accuracy}m. Adjust the map if needed.`
      : "Delivery pin selected. Adjust the map if needed.",
    denied: "Location permission was denied. Search a place or tap the map.",
    error: "Location could not be detected. Search a place or tap the map.",
    unsupported: "This browser does not support location detection. Search a place or tap the map."
  };

  return (
    <p className={`mt-3 rounded-xl border px-3 py-2 text-xs font-bold leading-5 ${
      state === "resolved"
        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
        : state === "loading"
          ? "border-slate-200 bg-slate-50 text-slate-600"
          : "border-amber-200 bg-amber-50 text-amber-800"
    }`}>
      {copy[state]}
    </p>
  );
}

async function searchPlaces(query: string, signal: AbortSignal) {
  const url = `${NOMINATIM_BASE_URL}/search?${new URLSearchParams({
    addressdetails: "1",
    countrycodes: "in",
    format: "jsonv2",
    limit: "6",
    q: query
  }).toString()}`;
  const response = await fetch(url, {
    headers: { "Accept-Language": "en" },
    signal
  });
  if (!response.ok) {
    throw new Error("place_search_failed");
  }
  return response.json() as Promise<PlaceSearchResult[]>;
}

async function reverseGeocode(latitude: number, longitude: number) {
  const url = `${NOMINATIM_BASE_URL}/reverse?${new URLSearchParams({
    addressdetails: "1",
    format: "jsonv2",
    lat: String(latitude),
    lon: String(longitude),
    zoom: "18"
  }).toString()}`;
  const response = await fetch(url, {
    headers: { "Accept-Language": "en" },
    signal: AbortSignal.timeout(7_000)
  });
  if (!response.ok) {
    throw new Error("reverse_geocode_failed");
  }
  return response.json() as Promise<ReverseGeocodeResult>;
}

function placeTitle(result: PlaceSearchResult) {
  return result.name || result.display_name?.split(",")[0]?.trim() || "Selected place";
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}
