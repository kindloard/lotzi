const DEFAULT_API_BASE_URL = "/api";

export function resolveApiBaseUrl(rawValue = process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_API_BASE_URL) {
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
