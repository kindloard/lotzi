import {
  Clock,
  CreditCard,
  Headphones,
  Heart,
  Mail,
  MapPin,
  ShieldCheck,
  ShoppingBag
} from "lucide-react";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { getDealProductsForLanding, getShopsForLanding } from "@/features/shops/api/server-shops";
import { LandingShopBrowser } from "@/features/shops/components/landing-shop-browser";
import { ShopsQueryProvider } from "@/features/shops/providers/shops-query-provider";
import { getTranslations } from "next-intl/server";

// Removed static footerLinks, now generated inside LandingFooter

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function HomePage() {
  await headers();

  const [shops, dealProducts] = await Promise.all([
    getShopsForLanding(),
    getDealProductsForLanding()
  ]);

  return (
    <main
      className="flex min-h-screen flex-col overflow-x-hidden bg-white font-sans text-slate-950 md:bg-slate-50/50"
      id="main-content"
    >
      <section className="mx-auto w-full max-w-[1400px] flex-1 space-y-5 px-4 pb-8 pt-6 sm:px-6 md:space-y-12 md:pb-14 md:pt-8 lg:px-8">
        <ShopsQueryProvider>
          <LandingShopBrowser initialProducts={dealProducts} initialShops={shops} />
        </ShopsQueryProvider>
      </section>

      <LandingFooter />
    </main>
  );
}

async function LandingFooter() {
  const t = await getTranslations("marketplace.footer");

  return (
    <footer className="mt-auto bg-white">
      <div className="mx-auto max-w-[1540px] px-6 pb-6 pt-16 sm:px-10 sm:pb-8 sm:pt-24 lg:px-12 lg:pt-32">
        <div className="mb-16 sm:mb-24">
          <h2 className="text-5xl font-black leading-[1.1] tracking-tight text-slate-200/80 sm:text-7xl lg:text-[110px]">
            Shop your city, <br />
            from your couch <Heart className="inline-block text-brand fill-brand align-baseline size-[0.8em]" />
          </h2>
        </div>

        <div className="flex flex-col gap-4 border-t border-slate-100 pt-6 text-[13px] font-bold text-[#111827] sm:flex-row-reverse sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-4 sm:gap-6">
            <Link href="#terms" className="transition-colors hover:opacity-80">{t("legal.terms")}</Link>
            <Link href="#privacy" className="transition-colors hover:opacity-80">{t("legal.privacy")}</Link>
            <Link href="#contact" className="transition-colors hover:opacity-80">{t("contact.title")}</Link>
          </div>
          <div>
            <span>{t("copyright")}</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
