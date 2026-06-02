import { NextRequest, NextResponse } from "next/server";
import createIntlMiddleware from "next-intl/middleware";
import { routing, type AppLocale } from "@/i18n/routing";

const protectedPaths = ["/merchant", "/account"];
const refreshCookieNames = ["lotzi_refresh", "__Host-refresh"];
const csrfCookieNames = ["lotzi_csrf", "__Host-csrf"];
const intlMiddleware = createIntlMiddleware(routing);
const legacyAuthRedirects = new Map([
  ["/login", "/en/auth/login"],
  ["/signup", "/en/auth/signup"],
  ["/otp", "/en/auth/otp"]
]);

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const repeatedLocaleTarget = repeatedLocalePath(pathname);
  if (repeatedLocaleTarget) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = repeatedLocaleTarget;
    return NextResponse.redirect(redirectUrl, 308);
  }

  const legacyTarget = legacyAuthRedirects.get(pathname);
  if (legacyTarget) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = legacyTarget;
    return NextResponse.redirect(redirectUrl, 308);
  }

  const locale = localeFromPathname(pathname);
  const pathWithoutLocale = locale ? stripLocalePrefix(pathname) : pathname;
  const isProtectedPath = protectedPaths.some((path) =>
    pathWithoutLocale === path || pathWithoutLocale.startsWith(`${path}/`)
  );

  if (!isProtectedPath) {
    return intlMiddleware(request);
  }

  const hasRecoverableSession =
    refreshCookieNames.some((name) => request.cookies.has(name)) &&
    csrfCookieNames.some((name) => request.cookies.has(name));
  if (hasRecoverableSession) {
    return intlMiddleware(request);
  }

  if (!locale) {
    return intlMiddleware(request);
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = `/${locale}/auth/login`;
  loginUrl.search = "";
  loginUrl.searchParams.set("next", safeNextPath(request, locale));
  return NextResponse.redirect(loginUrl);
}

function localeFromPathname(pathname: string): AppLocale | null {
  const maybeLocale = pathname.split("/")[1];
  return routing.locales.includes(maybeLocale as AppLocale) ? (maybeLocale as AppLocale) : null;
}

function repeatedLocalePath(pathname: string) {
  const parts = pathname.split("/");
  const firstLocale = parts[1];
  const secondLocale = parts[2];
  if (
    firstLocale &&
    firstLocale === secondLocale &&
    routing.locales.includes(firstLocale as AppLocale)
  ) {
    return `/${parts.slice(2).join("/")}` || "/";
  }
  return null;
}

function stripLocalePrefix(pathname: string) {
  const parts = pathname.split("/");
  parts.splice(1, 1);
  return parts.join("/") || "/";
}

function safeNextPath(request: NextRequest, locale: AppLocale) {
  const next = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  if (!next.startsWith(`/${locale}/`) || next.startsWith(`/${locale}/auth/`)) {
    return "/merchant/dashboard";
  }
  return stripLocalePrefix(next);
}

export const config = {
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"]
};
