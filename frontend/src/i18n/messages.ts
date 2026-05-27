import type { AppLocale } from "./routing";

type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];
type JsonObject = { [key: string]: JsonValue };

export type MessageNamespace =
  | "admin"
  | "auth"
  | "cart"
  | "common"
  | "dashboard"
  | "errors"
  | "marketplace"
  | "metadata"
  | "onboarding";

const namespaces: MessageNamespace[] = [
  "common",
  "auth",
  "onboarding",
  "dashboard",
  "marketplace",
  "cart",
  "admin",
  "errors",
  "metadata"
];

const namespaceLoaders: Record<AppLocale, Record<MessageNamespace, () => Promise<JsonObject>>> = {
  en: {
    common: () => import("../locales/en/common.json").then((module) => module.default),
    auth: () => import("../locales/en/auth.json").then((module) => module.default),
    onboarding: () => import("../locales/en/onboarding.json").then((module) => module.default),
    dashboard: () => import("../locales/en/dashboard.json").then((module) => module.default),
    marketplace: () => import("../locales/en/marketplace.json").then((module) => module.default),
    cart: () => import("../locales/en/cart.json").then((module) => module.default),
    admin: () => import("../locales/en/admin.json").then((module) => module.default),
    errors: () => import("../locales/en/errors.json").then((module) => module.default),
    metadata: () => import("../locales/en/metadata.json").then((module) => module.default)
  },
  ta: {
    common: () => import("../locales/ta/common.json").then((module) => module.default),
    auth: () => import("../locales/ta/auth.json").then((module) => module.default),
    onboarding: () => import("../locales/ta/onboarding.json").then((module) => module.default),
    dashboard: () => import("../locales/ta/dashboard.json").then((module) => module.default),
    marketplace: () => import("../locales/ta/marketplace.json").then((module) => module.default),
    cart: () => import("../locales/ta/cart.json").then((module) => module.default),
    admin: () => import("../locales/ta/admin.json").then((module) => module.default),
    errors: () => import("../locales/ta/errors.json").then((module) => module.default),
    metadata: () => import("../locales/ta/metadata.json").then((module) => module.default)
  }
};

const messageCache = new Map<AppLocale, Promise<Record<string, JsonObject>>>();
const fallbackKeyCache = new Map<AppLocale, Promise<string[]>>();

export function loadMessages(locale: AppLocale) {
  const cached = messageCache.get(locale);
  if (cached) {
    return cached;
  }
  const promise = loadMergedMessages(locale);
  messageCache.set(locale, promise);
  return promise;
}

export function getLocaleFallbackKeys(locale: AppLocale) {
  const cached = fallbackKeyCache.get(locale);
  if (cached) {
    return cached;
  }
  const promise = locale === "en" ? Promise.resolve([]) : collectFallbackKeys(locale);
  fallbackKeyCache.set(locale, promise);
  return promise;
}

async function loadMergedMessages(locale: AppLocale) {
  const english = await loadLocaleNamespaces("en");
  if (locale === "en") {
    return english;
  }
  const target = await loadLocaleNamespaces(locale);
  return deepMerge(english, target) as Record<string, JsonObject>;
}

async function loadLocaleNamespaces(locale: AppLocale) {
  const entries = await Promise.all(
    namespaces.map(async (namespace) => [namespace, await namespaceLoaders[locale][namespace]()] as const)
  );
  return Object.fromEntries(entries) as Record<string, JsonObject>;
}

async function collectFallbackKeys(locale: AppLocale) {
  const english = flatten(await loadLocaleNamespaces("en"));
  const target = flatten(await loadLocaleNamespaces(locale));
  return Object.keys(english).filter((key) => !(key in target)).sort();
}

function deepMerge(source: JsonObject, override: JsonObject): JsonObject {
  const output: JsonObject = { ...source };
  for (const [key, value] of Object.entries(override)) {
    const current = output[key];
    if (isPlainObject(current) && isPlainObject(value)) {
      output[key] = deepMerge(current, value);
    } else {
      output[key] = value;
    }
  }
  return output;
}

function flatten(value: JsonObject, prefix = "", output: Record<string, string> = {}) {
  for (const [key, child] of Object.entries(value)) {
    const nextKey = prefix ? `${prefix}.${key}` : key;
    if (typeof child === "string") {
      output[nextKey] = child;
    } else if (isPlainObject(child)) {
      flatten(child, nextKey, output);
    }
  }
  return output;
}

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

