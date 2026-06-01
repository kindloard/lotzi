"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Coordinates } from "../shops-api";

const GEO_CACHE_KEY = "ns:shops:geo:v2";
const GEO_CACHE_TTL_MS = 5 * 60 * 1000;
const HIGH_ACCURACY_TIMEOUT_MS = 10_000;

interface CachedCoordinates extends Coordinates {
  capturedAt: number;
}

export type LocationStatus = "idle" | "loading" | "resolved" | "denied" | "error" | "unsupported";

interface RequestLocationOptions {
  ignoreCache?: boolean;
}

export function usePreciseLocation() {
  const [coordinates, setCoordinates] = useState<Coordinates | null>(null);
  const [status, setStatus] = useState<LocationStatus>("idle");
  const requestIdRef = useRef(0);

  const requestLocation = useCallback((options: RequestLocationOptions = {}) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setStatus("unsupported");
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    const cached = options.ignoreCache ? null : readCoordinatesCache();
    if (cached) {
      setCoordinates(cached);
      setStatus("resolved");
    } else {
      setStatus("loading");
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (requestIdRef.current !== requestId) {
          return;
        }

        const next = coordinatesFromPosition(position);
        setCoordinates((current) => bestCoordinates(current, next));
        writeCoordinatesCache(next);
        setStatus("resolved");
      },
      (error) => {
        if (requestIdRef.current !== requestId) {
          return;
        }
        setStatus(error.code === error.PERMISSION_DENIED ? "denied" : "error");
      },
      {
        enableHighAccuracy: true,
        maximumAge: 30_000,
        timeout: HIGH_ACCURACY_TIMEOUT_MS
      }
    );
  }, []);

  useEffect(() => {
    requestLocation();
    return () => {
      requestIdRef.current += 1;
    };
  }, [requestLocation]);

  return { coordinates, requestLocation, status };
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
