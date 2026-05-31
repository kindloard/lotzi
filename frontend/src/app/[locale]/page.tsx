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
import { HeroCarousel } from "@/features/shops/components/hero-carousel";
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
      className="min-h-screen overflow-x-hidden bg-white font-sans text-slate-950 md:bg-slate-50/50"
      id="main-content"
    >
      <HeroCarousel />

      <section className="mx-auto w-full max-w-[1400px] space-y-5 px-4 pb-8 pt-2 sm:px-6 md:space-y-16 md:py-16 lg:px-8">
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
  
  const footerLinks = [
    {
      title: t("links.marketplace.title"),
      links: [
        t("links.marketplace.freshGroceries"),
        t("links.marketplace.localBakeries"),
        t("links.marketplace.organicProduce"),
        t("links.marketplace.dailyEssentials")
      ]
    },
    {
      title: t("links.customerCare.title"),
      links: [
        t("links.customerCare.helpCenter"),
        t("links.customerCare.trackOrder"),
        t("links.customerCare.refundPolicy"),
        t("links.customerCare.deliverySupport")
      ]
    },
    {
      title: t("links.company.title"),
      links: [
        t("links.company.about"),
        t("links.company.trustSafety"),
        t("links.company.localPartners"),
        t("links.company.careers")
      ]
    }
  ];

  return (
    <footer className="bg-slate-50 pb-0 sm:px-6 sm:pb-6 lg:px-8">
      <div className="mx-auto max-w-[1540px] overflow-hidden rounded-none border-0 sm:rounded-[2rem] sm:border sm:border-slate-200 bg-black text-slate-200 shadow-xl">
        <div className="grid gap-12 border-b border-slate-800 px-6 py-12 sm:px-10 lg:grid-cols-[1.2fr_1.8fr] lg:px-12 lg:py-16">
          <div className="max-w-xl space-y-8">
            <Link href="/" className="inline-flex items-center gap-3" aria-label="Namastore home">
              <span className="flex size-12 items-center justify-center rounded-xl bg-emerald-500 text-white shadow-sm">
                <ShoppingBag size={22} strokeWidth={2.4} />
              </span>
              <div>
                <p className="text-2xl font-black tracking-tight text-white">Namastore</p>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-400">
                  {t("tagline")}
                </p>
              </div>
            </Link>

            <p className="text-sm leading-relaxed text-slate-400">
              {t("description")}
            </p>


          </div>

          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {footerLinks.map((section) => (
              <div key={section.title}>
                <h3 className="text-[15px] font-semibold text-slate-100">
                  {section.title}
                </h3>
                <ul className="mt-4 space-y-3">
                  {section.links.map((item) => (
                    <li key={item}>
                      <Link
                        href="#"
                        className="text-sm font-medium text-slate-400 transition-colors hover:text-white"
                      >
                        {item}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}

            <div>
              <h3 className="text-[15px] font-semibold text-slate-100">
                {t("contact.title")}
              </h3>
              <div className="mt-4 space-y-3 text-sm font-medium text-slate-400">
                <Link href="mailto:support@namastore.in" className="flex items-center gap-3 transition-colors hover:text-white">
                  <Mail size={16} className="text-slate-500" />
                  support@namastore.in
                </Link>
                <Link href="#support" className="flex items-center gap-3 transition-colors hover:text-white">
                  <Headphones size={16} className="text-slate-500" />
                  {t("contact.support")}
                </Link>
                <div className="flex items-center gap-3 text-slate-400">
                  <MapPin size={16} className="text-slate-500" />
                  {t("contact.location")}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-6 px-6 py-8 text-[13px] font-medium text-slate-400 sm:px-10 lg:flex-row lg:items-center lg:justify-between lg:px-12">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span>{t("copyright")}</span>
            <span className="hidden h-1 w-1 shrink-0 rounded-full bg-slate-700 sm:block" />
            <span>{t("mission")}</span>
          </div>
          <div className="flex w-full flex-wrap justify-between gap-x-6 gap-y-3 sm:w-auto sm:justify-end">
            <Link href="#terms" className="transition-colors hover:text-white">{t("legal.terms")}</Link>
            <Link href="#privacy" className="transition-colors hover:text-white">{t("legal.privacy")}</Link>
            <Link href="#security" className="transition-colors hover:text-white">{t("legal.security")}</Link>
            <Link href="#accessibility" className="transition-colors hover:text-white">{t("legal.accessibility")}</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
