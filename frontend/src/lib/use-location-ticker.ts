"use client";

import { useState, useEffect, useCallback, useRef } from "react";

export interface LocationTick {
  label: string;
  sublabel?: string;
  isGps?: boolean;
}

interface GeocodeResult {
  address: {
    suburb?: string;
    village?: string;
    town?: string;
    city?: string;
    county?: string;
    state_district?: string;
    state?: string;
  };
}

const TICK_INTERVAL_MS = 3_000;
const GEO_TIMEOUT_MS = 8_000;
const GEO_CACHE_KEY = "ns:geo:v1";
const GEO_CACHE_TTL_MS = 10 * 60 * 1000; // 10 min

interface GeoCache {
  label: string;
  sublabel: string;
  cachedAt: number;
}

function readGeoCache(): GeoCache | null {
  try {
    const raw = sessionStorage.getItem(GEO_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GeoCache;
    if (Date.now() - parsed.cachedAt > GEO_CACHE_TTL_MS) {
      sessionStorage.removeItem(GEO_CACHE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeGeoCache(data: Omit<GeoCache, "cachedAt">) {
  try {
    sessionStorage.setItem(
      GEO_CACHE_KEY,
      JSON.stringify({ ...data, cachedAt: Date.now() })
    );
  } catch {
    // storage quota exceeded — ignore
  }
}

function extractPlaceName(result: GeocodeResult): { label: string; sublabel: string } {
  const a = result.address;
  const primary =
    a.suburb || a.village || a.town || a.city || a.county || a.state_district || "Your area";
  const secondary = a.town || a.city || a.state_district || a.state || "";
  return {
    label: primary,
    sublabel: secondary && secondary !== primary ? secondary : "",
  };
}

async function reverseGeocode(lat: number, lon: number): Promise<{ label: string; sublabel: string }> {
  const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=14&addressdetails=1`;
  const response = await fetch(url, {
    headers: { "Accept-Language": "en", "User-Agent": "NamaStore/1.0" },
    signal: AbortSignal.timeout(6_000),
  });
  if (!response.ok) throw new Error("geocode_failed");
  const data = (await response.json()) as GeocodeResult;
  return extractPlaceName(data);
}

function getCurrentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator?.geolocation) {
      reject(new Error("geolocation_unavailable"));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      timeout: GEO_TIMEOUT_MS,
      maximumAge: 5 * 60 * 1000,
      enableHighAccuracy: false,
    });
  });
}

/**
 * Returns a cycling list of location ticks and the current active index.
 * - Immediately reads GPS from cache (if fresh) or triggers new geolocation request
 * - Accepts optional saved address labels to cycle through
 * - Cycles every 5 seconds with a smooth scroll-up animation
 */
export function useLocationTicker({
  brandName,
  savedAddresses = [],
}: {
  brandName?: string;
  savedAddresses?: string[];
} = {}): {
  ticks: LocationTick[];
  activeIndex: number;
  isResetting: boolean;
  gpsStatus: "idle" | "loading" | "resolved" | "denied" | "error";
} {
  const [gpsLabel, setGpsLabel] = useState<string | null>(null);
  const [gpsSubLabel, setGpsSubLabel] = useState<string>("");
  const [gpsStatus, setGpsStatus] = useState<"idle" | "loading" | "resolved" | "denied" | "error">("idle");
  const [activeIndex, setActiveIndex] = useState(0);
  const [isResetting, setIsResetting] = useState(false);
  const resolvedRef = useRef(false);

  // Resolve GPS location once on mount
  const resolveGps = useCallback(async () => {
    // Try cache first for instant display
    const cached = readGeoCache();
    if (cached) {
      setGpsLabel(cached.label);
      setGpsSubLabel(cached.sublabel);
      setGpsStatus("resolved");
      resolvedRef.current = true;
      return;
    }

    setGpsStatus("loading");
    try {
      const position = await getCurrentPosition();
      const { label, sublabel } = await reverseGeocode(
        position.coords.latitude,
        position.coords.longitude
      );
      writeGeoCache({ label, sublabel });
      setGpsLabel(label);
      setGpsSubLabel(sublabel);
      setGpsStatus("resolved");
      resolvedRef.current = true;
    } catch (err) {
      const code = (err as GeolocationPositionError)?.code;
      // code 1 = PERMISSION_DENIED
      setGpsStatus(code === 1 ? "denied" : "error");
    }
  }, []);

  useEffect(() => {
    void resolveGps();
  }, [resolveGps]);

  // Build the ticks array: Brand Name first, then GPS, then saved addresses
  const ticks: LocationTick[] = [];

  if (brandName) {
    ticks.push({ label: brandName });
  }

  if (gpsStatus === "resolved" && gpsLabel) {
    ticks.push({ label: gpsLabel, sublabel: gpsSubLabel, isGps: true });
  } else if (gpsStatus === "loading") {
    ticks.push({ label: "Detecting location…", isGps: true });
  }

  for (const addr of savedAddresses) {
    if (addr) ticks.push({ label: addr, isGps: false });
  }

  // Fallback: if we have nothing, don't cycle at all
  const total = ticks.length;

  // Ticker interval: only cycle when we have more than 1 tick
  useEffect(() => {
    if (total <= 1) return;

    const timer = window.setInterval(() => {
      setActiveIndex((prev) => prev + 1);
    }, TICK_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [total]);

  // Seamless loop reset (same technique as the search placeholder)
  useEffect(() => {
    if (total <= 1 || activeIndex < total) return;

    let resumeTimer: number | undefined;
    const resetTimer = window.setTimeout(() => {
      setIsResetting(true);
      setActiveIndex(0);
      resumeTimer = window.setTimeout(() => setIsResetting(false), 40);
    }, 750);

    return () => {
      window.clearTimeout(resetTimer);
      if (resumeTimer) window.clearTimeout(resumeTimer);
    };
  }, [activeIndex, total]);

  return { ticks, activeIndex, isResetting, gpsStatus };
}
