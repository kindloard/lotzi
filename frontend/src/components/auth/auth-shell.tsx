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
        className="animate-scale-up flex min-h-[100dvh] w-full max-w-[390px] flex-col sm:min-h-[680px]"
        id="auth-content"
      >
        <div className="px-7 pt-7 text-center sm:hidden">
          <p className="text-[11px] font-bold tracking-[0.15em] text-zinc-900 uppercase">{tBrand("name")}</p>
          <div className="mt-3 flex justify-center">
            <LanguageSwitcher compact />
          </div>
        </div>
        <div className="hidden justify-end px-7 pt-7 sm:flex">
          <LanguageSwitcher compact />
        </div>
        {children}
      </section>
    </main>
  );
}
