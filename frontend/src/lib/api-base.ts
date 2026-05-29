const DEFAULT_API_BASE_URL = "/api";
const LOCAL_BACKEND_API_BASE_URL = "http://localhost:4000/api";

export function resolveApiBaseUrl(rawValue = process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_API_BASE_URL) {
  if (shouldUseDirectLocalApi(rawValue)) {
    return LOCAL_BACKEND_API_BASE_URL;
  }

  const normalized = rawValue.endsWith("/api")
    ? rawValue
    : `${rawValue.replace(/\/$/, "")}/api`;

  if (process.env.NEXT_PUBLIC_DIRECT_LOCAL_API === "true") {
    return normalized;
  }

  if (typeof window === "undefined" || !isLocalhostApi(normalized)) {
    return normalized;
  }

  return DEFAULT_API_BASE_URL;
}

function shouldUseDirectLocalApi(rawValue: string) {
  const normalizedRaw = rawValue.replace(/\/$/, "");
  if (
    process.env.NODE_ENV !== "development" ||
    process.env.NEXT_PUBLIC_DIRECT_LOCAL_API === "false" ||
    typeof window === "undefined" ||
    normalizedRaw !== DEFAULT_API_BASE_URL
  ) {
    return false;
  }

  return isLoopbackHost(window.location.hostname);
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
