"use client";

import { useTranslations } from "next-intl";
import { ReactNode } from "react";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";

interface AuthShellProps {
  children: ReactNode;
}

export function AuthShell({ children }: AuthShellProps) {
  const tBrand = useTranslations("common.brand");

  return (
    <main
      className="auth-system-sans flex min-h-[100dvh] items-stretch justify-center bg-white sm:items-center sm:px-4 sm:py-8"
      id="main-content"
    >
      <section
        className="relative animate-scale-up flex min-h-[100dvh] w-full max-w-[390px] flex-col sm:min-h-[680px]"
        id="auth-content"
      >
        <div className="absolute right-6 top-6 z-10 sm:hidden">
          <LanguageSwitcher compact />
        </div>
        <div className="px-7 pt-9 pb-2 text-center sm:hidden">
          <p className="text-[11px] font-bold tracking-[0.15em] text-zinc-900 uppercase">{tBrand("name")}</p>
        </div>
        <div className="hidden justify-end px-8 pt-8 sm:flex z-10 relative">
          <LanguageSwitcher compact />
        </div>
        {children}
      </section>
    </main>
  );
}
