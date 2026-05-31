"use client";

import { useEffect, useRef, useState } from "react";
import { Languages } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { localeMeta } from "@/i18n/locale-meta";
import { beforeLocaleSwitchEvent } from "@/i18n/onboarding-snapshot";
import { localeCookie, routing, type AppLocale } from "@/i18n/routing";

export const localeStorageKey = "namastore:locale";

export function LanguageSwitcher({ compact = false, className }: { compact?: boolean; className?: string }) {
  const locale = useLocale() as AppLocale;
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations("common.language");
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const switchLocale = (nextLocale: AppLocale) => {
    if (nextLocale === locale) {
      setIsOpen(false);
      return;
    }
    window.dispatchEvent(new CustomEvent(beforeLocaleSwitchEvent, { detail: { locale, nextLocale } }));
    writeLocalePreference(nextLocale);
    router.replace(pathname, { locale: nextLocale });
    router.refresh();
    setIsOpen(false);
  };

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  return (
    <div className="relative inline-block text-left" ref={containerRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={className || "flex size-10 items-center justify-center rounded-2xl border border-transparent bg-transparent text-slate-700 shadow-none transition hover:bg-slate-50 hover:text-slate-900 focus:outline-none md:border md:border-slate-200 md:bg-slate-50 md:text-slate-700 md:shadow-none md:hover:bg-white md:hover:-translate-y-0.5 cursor-pointer"}
        aria-label={t("switcher")}
        aria-expanded={isOpen}
        aria-haspopup="true"
        type="button"
      >
        <Languages size={16} strokeWidth={2.2} />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2.5 w-60 origin-top-right rounded-2xl bg-white p-2 shadow-[0_12px_40px_-4px_rgba(15,23,42,0.06),0_4px_20px_-2px_rgba(15,23,42,0.02)] animate-scale-up z-50">
          <div className="flex flex-col gap-1">
            {routing.locales.map((item) => {
              const isActive = item === locale;
              return (
                <button
                  key={item}
                  onClick={() => switchLocale(item)}
                  className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl transition-all duration-200 text-left cursor-pointer w-full ${
                    isActive
                      ? "bg-zinc-100 text-black"
                      : "text-zinc-900 hover:bg-zinc-50 hover:text-zinc-955"
                  }`}
                  type="button"
                >
                  <span className="text-[13px] font-bold">
                    {localeMeta[item].nativeLabel}
                  </span>
                  <span className={`text-[10px] font-bold tracking-wider uppercase ${
                    isActive ? "text-zinc-500" : "text-zinc-400"
                  }`}>
                    {localeMeta[item].label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
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
