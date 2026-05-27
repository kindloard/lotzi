import { SessionResponse } from "@/lib/auth-api";
import { routing } from "@/i18n/routing";

export interface RedirectValidationResult {
  path: string | null;
  reason: string | null;
}

const controlOrBackslashPattern = /[\u0000-\u001F\u007F\\]/;

export function validateInternalRedirect(
  rawNext: string | null | undefined,
  origin = typeof window !== "undefined" ? window.location.origin : "http://localhost"
): RedirectValidationResult {
  if (!rawNext) {
    return { path: null, reason: null };
  }

  let decoded = rawNext.trim();
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    return { path: null, reason: "invalid-encoding" };
  }

  if (!decoded) {
    return { path: null, reason: "empty" };
  }
  if (controlOrBackslashPattern.test(decoded)) {
    return { path: null, reason: "invalid-character" };
  }
  if (decoded.includes("://")) {
    return { path: null, reason: "absolute-url" };
  }
  if (!decoded.startsWith("/")) {
    return { path: null, reason: "not-relative" };
  }
  if (decoded.startsWith("//")) {
    return { path: null, reason: "protocol-relative" };
  }

  try {
    const url = new URL(decoded, origin);
    if (url.origin !== origin) {
      return { path: null, reason: "external-origin" };
    }

    return {
      path: toIntlInternalPath(`${url.pathname}${url.search}${url.hash}`),
      reason: null
    };
  } catch {
    return { path: null, reason: "invalid-url" };
  }
}

export function defaultAuthRedirect(session: SessionResponse) {
  return toIntlInternalPath(session.redirectTo || session.routeState?.redirectTo || "/");
}

function toIntlInternalPath(path: string) {
  const [pathnameWithLocale, suffix = ""] = splitPathSuffix(path);
  const [, maybeLocale, ...rest] = pathnameWithLocale.split("/");
  if (!routing.locales.includes(maybeLocale as never)) {
    return path;
  }

  const internalPath = `/${rest.join("/")}` || "/";
  return `${internalPath === "/" ? "/" : internalPath}${suffix}`;
}

function splitPathSuffix(path: string) {
  const suffixStart = path.search(/[?#]/);
  if (suffixStart === -1) {
    return [path, ""] as const;
  }
  return [path.slice(0, suffixStart), path.slice(suffixStart)] as const;
}
