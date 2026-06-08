"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Coordinates } from "../shops-api";
import { clearGeoGridCookie, coordinatesDriftedBeyondGrid } from "../lib/geo-cookie";

const GEO_CACHE_KEY = "ns:shops:geo:v2";
const GEO_CACHE_TTL_MS = 5 * 60 * 1000;
const LOCATION_REQUEST_TIMEOUT_MS = 15_000;
const MIN_LOCATION_REQUEST_FEEDBACK_MS = 450;
const GEOLOCATION_PERMISSION_DENIED_CODE = 1;

interface CachedCoordinates extends Coordinates {
  capturedAt: number;
}

export type LocationStatus = "idle" | "loading" | "resolved" | "denied" | "error" | "unsupported";

interface RequestLocationOptions {
  ignoreCache?: boolean;
}

let memoryCoordinates: Coordinates | null = null;
let memoryStatus: LocationStatus | null = null;
let isHydrated = false;

export function usePreciseLocation(initialCoordinates: Coordinates | null = null) {
  const [coordinates, setInternalCoordinates] = useState<Coordinates | null>(() => {
    if (initialCoordinates) return initialCoordinates;
    if (memoryCoordinates) return memoryCoordinates;
    return null;
  });

  const [status, setInternalStatus] = useState<LocationStatus>(() => {
    if (initialCoordinates) return "resolved";
    if (memoryStatus) return memoryStatus;
    if (typeof window !== "undefined") {
      const cached = readCoordinatesCache();
      if (cached) return "resolved";
      if (readGeoGrantedFlag()) return "loading";
    }
    return "idle";
  });

  const setCoordinates = useCallback((updater: Coordinates | null | ((c: Coordinates | null) => Coordinates | null)) => {
    setInternalCoordinates((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      memoryCoordinates = next;
      return next;
    });
  }, []);

  const setStatus = useCallback((updater: LocationStatus | ((s: LocationStatus) => LocationStatus)) => {
    setInternalStatus((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      memoryStatus = next;
      return next;
    });
  }, []);

  const requestIdRef = useRef(0);

  const requestLocation = useCallback(async (options: RequestLocationOptions = {}) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      clearGeoGridCookie();
      setStatus("unsupported");
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    const permissionState = await readGeolocationPermission();
    if (requestIdRef.current !== requestId) {
      return;
    }
    if (permissionState === "denied") {
      clearCoordinatesCache();
      clearGeoGridCookie();
      removeGeoGrantedFlag();
      setCoordinates(null);
      setStatus("denied");
      return;
    }

    const cached = !options.ignoreCache && (permissionState === "granted" || permissionState === null)
      ? readCoordinatesCache()
      : null;
    if (cached) {
      setCoordinates(cached);
      setStatus("resolved");
      return;
    }

    setStatus("loading");
    const requestStartedAt = Date.now();
    try {
      const position = await getCurrentPosition();
      if (requestIdRef.current !== requestId) {
        return;
      }

      const next = coordinatesFromPosition(position);
      setCoordinates((current) => bestCoordinates(current, next));
      writeCoordinatesCache(next);
      writeGeoGrantedFlag();
      setStatus("resolved");
    } catch (error) {
      if (requestIdRef.current !== requestId) {
        return;
      }
      await waitForMinimumFeedback(requestStartedAt);
      if (requestIdRef.current !== requestId) {
        return;
      }
      if (isPermissionDenied(error)) {
        clearCoordinatesCache();
        clearGeoGridCookie();
        removeGeoGrantedFlag();
        setCoordinates(null);
        setStatus("denied");
      } else {
        setStatus("error");
      }
    }
  }, []);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      clearGeoGridCookie();
      setStatus("unsupported");
      return;
    }

    if (!initialCoordinates && !memoryCoordinates) {
      const cached = readCoordinatesCache();
      if (cached) {
        setCoordinates(cached);
        setStatus("resolved");
      }
    }

    let cancelled = false;
    let permissionStatus: PermissionStatus | null = null;

    const applyPermissionState = (permissionState: PermissionState | null) => {
      if (cancelled) {
        return;
      }
      if (permissionState === "denied") {
        clearCoordinatesCache();
        clearGeoGridCookie();
        removeGeoGrantedFlag();
        setCoordinates(null);
        setStatus("denied");
      } else if (permissionState === "granted") {
        void requestLocation();
      } else if (permissionState === "prompt") {
        setCoordinates(null);
        setStatus((current) =>
          current === "denied" || current === "error" ? "idle" : current
        );
      } else if (permissionState === null) {
        if (readGeoGrantedFlag() || readCoordinatesCache()) {
          void requestLocation();
        }
      }
    };

    const refreshPermissionState = async () => {
      applyPermissionState(await readGeolocationPermission());
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refreshPermissionState();
      }
    };

    queryGeolocationPermission().then((permission) => {
      if (cancelled || !permission) {
        return;
      }
      permissionStatus = permission;
      permissionStatus.onchange = () => applyPermissionState(permissionStatus?.state ?? null);
      applyPermissionState(permissionStatus.state);
    });

    window.addEventListener("focus", refreshPermissionState);
    window.addEventListener("pageshow", refreshPermissionState);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      if (permissionStatus) {
        permissionStatus.onchange = null;
      }
      window.removeEventListener("focus", refreshPermissionState);
      window.removeEventListener("pageshow", refreshPermissionState);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      requestIdRef.current += 1;
    };
  }, [requestLocation]);

  return { coordinates, requestLocation, status };
}

function waitForMinimumFeedback(startedAt: number): Promise<void> {
  const remaining = MIN_LOCATION_REQUEST_FEEDBACK_MS - (Date.now() - startedAt);
  return remaining > 0
    ? new Promise((resolve) => window.setTimeout(resolve, remaining))
    : Promise.resolve();
}

function getCurrentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: false,
      maximumAge: 60_000,
      timeout: LOCATION_REQUEST_TIMEOUT_MS
    });
  });
}

function isPermissionDenied(error: unknown): boolean {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === GEOLOCATION_PERMISSION_DENIED_CODE;
}

async function readGeolocationPermission(): Promise<PermissionState | null> {
  return (await queryGeolocationPermission())?.state ?? null;
}

async function queryGeolocationPermission(): Promise<PermissionStatus | null> {
  try {
    if (typeof navigator === "undefined" || !navigator.permissions?.query) {
      return null;
    }
    return await navigator.permissions.query({ name: "geolocation" as PermissionName });
  } catch {
    return null;
  }
}

function coordinatesFromPosition(position: GeolocationPosition): Coordinates {
  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracyMeters: position.coords.accuracy
  };
}

function bestCoordinates(current: Coordinates | null, next: Coordinates) {
  if (!current) {
    return next;
  }
  if (coordinatesDriftedBeyondGrid(current, next)) {
    return next;
  }

  const currentAccuracy = current.accuracyMeters ?? Number.POSITIVE_INFINITY;
  const nextAccuracy = next.accuracyMeters ?? Number.POSITIVE_INFINITY;
  return nextAccuracy <= currentAccuracy ? next : current;
}

function readCoordinatesCache(): Coordinates | null {
  try {
    const raw = sessionStorage.getItem(GEO_CACHE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as CachedCoordinates;
    if (Date.now() - parsed.capturedAt > GEO_CACHE_TTL_MS) {
      sessionStorage.removeItem(GEO_CACHE_KEY);
      return null;
    }

    return {
      latitude: parsed.latitude,
      longitude: parsed.longitude,
      accuracyMeters: parsed.accuracyMeters
    };
  } catch {
    return null;
  }
}

function writeCoordinatesCache(coordinates: Coordinates) {
  try {
    sessionStorage.setItem(
      GEO_CACHE_KEY,
      JSON.stringify({ ...coordinates, capturedAt: Date.now() } satisfies CachedCoordinates)
    );
  } catch {
    // Location still works without storage.
  }
}

function clearCoordinatesCache() {
  try {
    sessionStorage.removeItem(GEO_CACHE_KEY);
  } catch {
    // Location gating still works without storage.
  }
}

const GEO_GRANTED_FLAG_KEY = "ns:shops:geo:granted";

function writeGeoGrantedFlag() {
  try {
    localStorage.setItem(GEO_GRANTED_FLAG_KEY, "true");
  } catch {
    // Ignore
  }
}

function readGeoGrantedFlag() {
  try {
    return localStorage.getItem(GEO_GRANTED_FLAG_KEY) === "true";
  } catch {
    return false;
  }
}

function removeGeoGrantedFlag() {
  try {
    localStorage.removeItem(GEO_GRANTED_FLAG_KEY);
  } catch {
    // Ignore
  }
}
