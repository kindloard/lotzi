"use client";

import { Languages } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { localeMeta } from "@/i18n/locale-meta";
import { beforeLocaleSwitchEvent } from "@/i18n/onboarding-snapshot";
import { localeCookie, routing, type AppLocale } from "@/i18n/routing";

export const localeStorageKey = "namastore:locale";

export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const locale = useLocale() as AppLocale;
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations("common.language");

  const switchLocale = (nextLocale: AppLocale) => {
    if (nextLocale === locale) {
      return;
    }
    window.dispatchEvent(new CustomEvent(beforeLocaleSwitchEvent, { detail: { locale, nextLocale } }));
    writeLocalePreference(nextLocale);
    router.replace(pathname, { locale: nextLocale });
    router.refresh();
  };

  return (
    <div
      aria-label={t("switcher")}
      className="inline-flex items-center gap-1 rounded-xl border border-zinc-200 bg-white p-1 shadow-sm"
      role="group"
    >
      {!compact && <Languages className="mx-1 text-zinc-500" size={14} />}
      {routing.locales.map((item) => (
        <button
          aria-pressed={item === locale}
          className={`h-8 rounded-lg px-2.5 text-[12px] font-semibold transition ${
            item === locale ? "bg-zinc-950 text-white" : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-950"
          }`}
          data-i18n-fit
          key={item}
          onClick={() => switchLocale(item)}
          type="button"
        >
          {localeMeta[item].nativeLabel}
        </button>
      ))}
    </div>
  );
}

export function writeLocalePreference(locale: AppLocale) {
  const secure = localeCookie.secure ? "; Secure" : "";
  document.cookie = `${localeCookie.name}=${locale}; Path=/; Max-Age=${localeCookie.maxAge}; SameSite=Lax${secure}`;
  try {
    localStorage.setItem(localeStorageKey, locale);
  } catch {
    // Locale URL remains the source of truth.
  }
}
