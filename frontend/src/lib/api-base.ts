const DEFAULT_API_BASE_URL = "/api";
const LOCAL_BACKEND_API_BASE_URL = "http://localhost:4000/api";

export function resolveApiBaseUrl(rawValue = process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_API_BASE_URL) {
  const normalized = normalizeApiBaseUrl(rawValue);

  if (shouldUseDirectLocalApi(normalized)) {
    return normalized === DEFAULT_API_BASE_URL ? LOCAL_BACKEND_API_BASE_URL : normalized;
  }

  if (isUnsafeLoopbackApi(normalized)) {
    return DEFAULT_API_BASE_URL;
  }

  return normalized;
}

function normalizeApiBaseUrl(rawValue: string) {
  const raw = rawValue.trim() || DEFAULT_API_BASE_URL;
  const trimmed = raw.replace(/\/+$/, "");

  if (!trimmed || trimmed === DEFAULT_API_BASE_URL) {
    return DEFAULT_API_BASE_URL;
  }

  return trimmed.endsWith("/api") ? trimmed : `${trimmed}/api`;
}

function shouldUseDirectLocalApi(normalizedValue: string) {
  return Boolean(
    process.env.NODE_ENV === "development" &&
    process.env.NEXT_PUBLIC_DIRECT_LOCAL_API === "true" &&
    typeof window !== "undefined" &&
    isLoopbackHost(window.location.hostname) &&
    (normalizedValue === DEFAULT_API_BASE_URL || isLocalhostApi(normalizedValue))
  );
}

function isUnsafeLoopbackApi(value: string) {
  if (!isLocalhostApi(value)) {
    return false;
  }

  if (process.env.NODE_ENV === "production" || process.env.NEXT_PUBLIC_DIRECT_LOCAL_API !== "true") {
    return true;
  }

  return typeof window === "undefined" || !isLoopbackHost(window.location.hostname);
}

function isLocalhostApi(value: string) {
  try {
    return isLoopbackHost(new URL(value).hostname);
  } catch {
    return false;
  }
}

function isLoopbackHost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}
