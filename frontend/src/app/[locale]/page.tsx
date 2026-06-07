import { cookies } from "next/headers";
import { getNearbyShopsForLandingGeoCookie } from "@/features/shops/api/server-shops";
import { LandingShopBrowser } from "@/features/shops/components/landing-shop-browser";
import { GEO_GRID_COOKIE_NAME } from "@/features/shops/lib/geo-cookie";
import { StorefrontFooter } from "@/features/shops/components/storefront-footer";
import { ShopsQueryProvider } from "@/features/shops/providers/shops-query-provider";

// force-dynamic: page reads a per-user geo cookie — cannot be cached at CDN level.
// The SSR nearby fetch has a tight 200ms budget (HOME_GEO_SSR_BUDGET_MS) so it
// never blocks the page render. Redis L1 hits complete in ~10ms.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function HomePage() {
  const cookieStore = await cookies();
  const geoCookieValue = cookieStore.get(GEO_GRID_COOKIE_NAME)?.value;

  // Fast SSR path: attempt to pre-load nearby shops from the geo cookie.
  // Budget: HOME_GEO_SSR_BUDGET_MS (200ms). On Redis L1/L2 hit: ~10-30ms.
  // On miss or timeout, returns null — client initiates the geo flow normally.
  const initialNearby = await getNearbyShopsForLandingGeoCookie(geoCookieValue);

  return (
    <main
      className="flex min-h-screen flex-col overflow-x-hidden bg-white font-sans text-slate-950 md:bg-slate-50/50"
      id="main-content"
    >
      <section className="mx-auto w-full max-w-[1400px] flex-1 space-y-5 px-4 pb-8 pt-6 sm:px-6 md:space-y-12 md:pb-14 md:pt-8 lg:px-8">
        <ShopsQueryProvider>
          <LandingShopBrowser initialNearby={initialNearby} />
        </ShopsQueryProvider>
      </section>

      <StorefrontFooter />
    </main>
  );
}
