export interface I18nFallbackPayload {
  key: string;
  locale: string;
  namespace: string;
  routeTemplate: string;
}

const sent = new Set<string>();

export function reportI18nFallback(payload: I18nFallbackPayload) {
  if (typeof navigator === "undefined" || payload.locale === "en") {
    return;
  }
  const fingerprint = [
    payload.locale,
    payload.namespace,
    payload.key,
    payload.routeTemplate,
    sessionFingerprint()
  ].join("|");
  if (sent.has(fingerprint)) {
    return;
  }
  sent.add(fingerprint);

  const body = JSON.stringify({
    locale: payload.locale,
    namespace: payload.namespace,
    key: payload.key,
    routeTemplate: payload.routeTemplate
  });
  const blob = new Blob([body], { type: "application/json" });
  if (!navigator.sendBeacon("/api/observability/i18n-fallback", blob)) {
    void fetch("/api/observability/i18n-fallback", {
      body,
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      method: "POST"
    }).catch(() => undefined);
  }
}

export function routeTemplateForPathname(pathname: string) {
  const withoutQuery = pathname.split("?")[0] || "/";
  const normalized = withoutQuery.replace(/^\/(?:en|ta)(?=\/|$)/, "/[locale]");

  if (/^\/\[locale\]\/merchant\/products\/[^/]+$/.test(normalized)) {
    return "/[locale]/merchant/products/[productId]";
  }
  if (/^\/\[locale\]\/merchant\/orders\/[^/]+$/.test(normalized)) {
    return "/[locale]/merchant/orders/[orderId]";
  }

  return normalized
    .split("/")
    .map((segment) => {
      if (/^[0-9a-f]{8,}$/i.test(segment) || /^[A-Z]{2,}-\d+$/i.test(segment)) {
        return "[id]";
      }
      return segment;
    })
    .join("/");
}

function sessionFingerprint() {
  const key = "lotzi:i18n-telemetry-session";
  try {
    const existing = sessionStorage.getItem(key);
    if (existing) {
      return existing;
    }
    const next = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    sessionStorage.setItem(key, next);
    return next;
  } catch {
    return "no-session-storage";
  }
}

