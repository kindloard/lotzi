import { headers } from "next/headers";
import { getDealProductsForLanding, getShopsForLanding } from "@/features/shops/api/server-shops";
import { LandingShopBrowser } from "@/features/shops/components/landing-shop-browser";
import { StorefrontFooter } from "@/features/shops/components/storefront-footer";
import { ShopsQueryProvider } from "@/features/shops/providers/shops-query-provider";

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

      <StorefrontFooter />
    </main>
  );
}
