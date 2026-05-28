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

const footerLinks = [
  {
    title: "Marketplace",
    links: ["Fresh groceries", "Local bakeries", "Organic produce", "Daily essentials"]
  },
  {
    title: "Customer Care",
    links: ["Help center", "Track an order", "Refund policy", "Delivery support"]
  },
  {
    title: "Company",
    links: ["About Namastore", "Trust & safety", "Local partners", "Careers"]
  }
];

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

        <ValuePropositions />
      </section>

      <LandingFooter />
    </main>
  );
}

function ValuePropositions() {
  return (
    <div id="how-it-works" className="relative overflow-hidden rounded-3xl border border-slate-200/80 bg-white p-8 shadow-sm md:p-12">
      <div className="mx-auto mb-12 max-w-3xl space-y-4 text-center">
        <h2 className="text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">
          The Namastore Promise
        </h2>
        <p className="mx-auto max-w-xl text-sm text-slate-500">
          Connecting you directly with local shops to keep neighborhood commerce thriving, fast, and fresh.
        </p>
      </div>

      <div className="grid gap-8 md:grid-cols-3">
        <div className="space-y-3.5 p-4 text-center">
          <span className="inline-flex size-11 items-center justify-center rounded-2xl border border-emerald-100 bg-emerald-50 text-emerald-700 shadow-inner">
            <ShieldCheck size={20} strokeWidth={2.2} />
          </span>
          <h3 className="text-sm font-bold text-slate-900">Support Local Shops</h3>
          <p className="mx-auto max-w-xs text-xs leading-relaxed text-slate-500">
            Every purchase directly supports independent local businesses and vendors in your neighborhood.
          </p>
        </div>

        <div className="space-y-3.5 border-y border-slate-100 p-4 text-center md:border-x md:border-y-0">
          <span className="inline-flex size-11 items-center justify-center rounded-2xl border border-amber-100 bg-amber-50 text-amber-700 shadow-inner">
            <Clock size={20} strokeWidth={2.2} />
          </span>
          <h3 className="text-sm font-bold text-slate-900">Under 30 Min Delivery</h3>
          <p className="mx-auto max-w-xs text-xs leading-relaxed text-slate-500">
            Orders are picked immediately and delivered by local partners who live right in your neighborhood.
          </p>
        </div>

        <div className="space-y-3.5 p-4 text-center">
          <span className="inline-flex size-11 items-center justify-center rounded-2xl border border-rose-100 bg-rose-50 text-rose-700 shadow-inner">
            <Heart size={20} strokeWidth={2.2} />
          </span>
          <h3 className="text-sm font-bold text-slate-900">Guaranteed Freshness</h3>
          <p className="mx-auto max-w-xs text-xs leading-relaxed text-slate-500">
            Handpicked items selected directly from local store shelves, ensuring peak freshness and quality.
          </p>
        </div>
      </div>
    </div>
  );
}

function LandingFooter() {
  return (
    <footer className="bg-slate-50 px-3 pb-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1540px] overflow-hidden rounded-[2rem] border border-slate-200 bg-zinc-950 text-stone-100 shadow-[0_28px_90px_rgb(15_23_42_/_0.14)]">
        <div className="grid gap-10 border-b border-stone-200/10 px-6 py-10 sm:px-8 lg:grid-cols-[1.15fr_1.85fr] lg:px-12 lg:py-14">
          <div className="max-w-xl space-y-6">
            <Link href="/" className="inline-flex items-center gap-3" aria-label="Namastore home">
              <span className="flex size-12 items-center justify-center rounded-2xl border border-stone-200/12 bg-stone-100 text-zinc-950 shadow-sm">
                <ShoppingBag size={22} strokeWidth={2.4} />
              </span>
              <div>
                <p className="text-xl font-black tracking-tight text-white">Namastore</p>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-200">
                  Local commerce, elevated
                </p>
              </div>
            </Link>

            <p className="text-sm leading-7 text-stone-300">
              Premium neighborhood shopping for fresh groceries, warm bakery goods, daily essentials, and trusted local delivery across nearby Indian communities.
            </p>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <FooterMetric icon={<Clock size={17} className="text-amber-200" />} label="Average delivery" value="15 min" />
              <FooterMetric icon={<ShieldCheck size={17} className="text-amber-200" />} label="Protected checkout" value="Secure" />
              <FooterMetric icon={<CreditCard size={17} className="text-amber-200" />} label="Rupee billing" value="INR" />
            </div>
          </div>

          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {footerLinks.map((section) => (
              <div key={section.title}>
                <h3 className="text-xs font-black uppercase tracking-[0.18em] text-stone-400">
                  {section.title}
                </h3>
                <ul className="mt-4 space-y-3">
                  {section.links.map((item) => (
                    <li key={item}>
                      <Link
                        href="#"
                        className="text-sm font-semibold text-stone-200 transition-colors hover:text-amber-200"
                      >
                        {item}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}

            <div>
              <h3 className="text-xs font-black uppercase tracking-[0.18em] text-stone-400">
                Contact
              </h3>
              <div className="mt-4 space-y-3 text-sm font-semibold text-stone-200">
                <Link href="mailto:support@namastore.in" className="flex items-center gap-2 transition-colors hover:text-amber-200">
                  <Mail size={15} className="text-amber-200" />
                  support@namastore.in
                </Link>
                <Link href="#support" className="flex items-center gap-2 transition-colors hover:text-amber-200">
                  <Headphones size={15} className="text-amber-200" />
                  24/7 support
                </Link>
                <div className="flex items-center gap-2 text-stone-300">
                  <MapPin size={15} className="text-amber-200" />
                  Bengaluru, India
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-5 px-6 py-6 text-xs font-semibold text-stone-400 sm:px-8 lg:flex-row lg:items-center lg:justify-between lg:px-12">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span>(c) 2026 Namastore Technologies</span>
            <span className="hidden h-1 w-1 rounded-full bg-stone-600 sm:block" />
            <span>Built for fast, local, rupee-first commerce.</span>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <Link href="#terms" className="transition-colors hover:text-stone-100">Terms</Link>
            <Link href="#privacy" className="transition-colors hover:text-stone-100">Privacy</Link>
            <Link href="#security" className="transition-colors hover:text-stone-100">Security</Link>
            <Link href="#accessibility" className="transition-colors hover:text-stone-100">Accessibility</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}

function FooterMetric({
  icon,
  label,
  value
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-stone-200/10 bg-stone-100/[0.04] p-4">
      {icon}
      <p className="mt-3 text-sm font-black text-white">{value}</p>
      <p className="mt-1 text-[11px] font-semibold text-stone-400">{label}</p>
    </div>
  );
}
