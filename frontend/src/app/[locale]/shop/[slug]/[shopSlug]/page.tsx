import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { MapPin } from "lucide-react";
import { Link } from "@/i18n/navigation";
import {
  getShopDetailForPage,
  getShopProductsForPage,
  normalizeProductFilters,
  ShopPageFetchError
} from "@/features/shops/api/server-shops";
import { ShopCatalog } from "@/features/shops/components/shop-catalog";
import { ShopsQueryProvider } from "@/features/shops/providers/shops-query-provider";
import type { ShopDetail, ShopProductsFilters, ShopProductsResponse } from "@/features/shops/shops-api";

type ShopPageProps = {
  params: Promise<{ locale: string; slug: string; shopSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const revalidate = 300;

export async function generateMetadata({ params, searchParams }: ShopPageProps): Promise<Metadata> {
  const [{ locale, slug: shopCode, shopSlug }, rawSearchParams] = await Promise.all([params, searchParams]);
  const hasCatalogQuery = hasIndexChangingQuery(rawSearchParams);

  try {
    const shop = await getShopDetailForPage(shopCode, shopSlug);
    const title = `${shop.name} | Namastore`;
    const description = metaDescription(shop);
    const canonical = canonicalPath(locale, shop.publicId, shop.publicSlug);

    return {
      alternates: {
        canonical
      },
      description,
      openGraph: {
        description,
        images: shop.bannerUrl ? [{ url: shop.bannerUrl }] : [],
        title,
        type: "website",
        url: absoluteUrl(canonical)
      },
      robots: hasCatalogQuery
        ? {
            follow: true,
            index: false
          }
        : {
            follow: true,
            index: true
          },
      title,
      twitter: {
        card: "summary_large_image",
        description,
        images: shop.bannerUrl ? [shop.bannerUrl] : [],
        title
      }
    };
  } catch (error) {
    if (error instanceof ShopPageFetchError && (error.status === 404 || error.status === 410)) {
      return {
        robots: {
          follow: false,
          index: false
        },
        title: "Store unavailable | Namastore"
      };
    }
    return {
      title: "Store | Namastore"
    };
  }
}

export default async function ShopPage({ params, searchParams }: ShopPageProps) {
  const [{ locale, slug: shopCode, shopSlug }, rawSearchParams] = await Promise.all([params, searchParams]);
  let shop: ShopDetail;

  try {
    shop = await getShopDetailForPage(shopCode, shopSlug);
  } catch (error) {
    if (error instanceof ShopPageFetchError) {
      if (error.status === 404) {
        notFound();
      }
      if (error.status === 410) {
        return <ShopUnavailable locale={locale} title="This store is no longer available" />;
      }
    }
    throw error;
  }

  const filters = filtersFromSearchParams(rawSearchParams);

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950" id="main-content">
      <ShopHero shop={shop} />
      <ShopsQueryProvider>
        <Suspense fallback={<CatalogFallback />}>
          <ServerShopCatalog locale={locale} shop={shop} filters={filters} />
        </Suspense>
      </ShopsQueryProvider>
    </main>
  );
}

async function ServerShopCatalog({
  locale,
  shop,
  filters
}: {
  locale: string;
  shop: ShopDetail;
  filters: ShopProductsFilters;
}) {
  const products = await getShopProductsForPage(shop.publicId, shop.publicSlug, filters);

  return (
    <>
      <ShopCatalog
        initialFailed={products.failed}
        initialFilters={filters}
        initialProducts={products.data}
        shop={shop}
      />
      <JsonLd locale={locale} products={products.data} shop={shop} />
    </>
  );
}

import { ShopHeaderMobile } from "@/components/shop-header-mobile";

function ShopHero({ shop }: { shop: ShopDetail }) {
  const address = formatAddress(shop);

  return (
    <>
      {/* Mobile Sticky Header */}
      <ShopHeaderMobile shopName={shop.name} address={address} typeName={shop.typeName} />
      
      {/* Desktop Header */}
      <section className="bg-white border-b border-slate-200 hidden md:block">
        <div className="mx-auto max-w-6xl px-4 py-4 sm:py-6">
          {/* Title Row */}
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center">
              <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight leading-snug">
                {shop.name}
              </h1>
            </div>
          </div>

          {/* Location Row */}
          <div className="mt-2 flex flex-col gap-1.5 text-[13px] font-medium text-slate-600">
            <div className="flex items-center gap-1.5">
              <MapPin size={14} className="text-slate-400 shrink-0" />
              <span className="truncate">{address}</span>
            </div>
          </div>

        </div>
      </section>
    </>
  );
}

function CatalogFallback() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="h-12 rounded-lg bg-slate-100" />
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {Array.from({ length: 10 }).map((_, index) => (
          <div key={index} className="h-72 rounded-lg bg-slate-100" />
        ))}
      </div>
    </div>
  );
}

function ShopUnavailable({ title }: { locale: string; title: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-4 text-center">
      <div className="max-w-md">
        <p className="text-sm font-black uppercase tracking-wide text-slate-400">Store unavailable</p>
        <h1 className="mt-3 text-3xl font-black tracking-tight text-slate-950">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          The store may have closed, moved, or changed its public listing.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex h-11 items-center justify-center rounded-lg bg-black px-5 text-sm font-black text-white"
        >
          Browse nearby shops
        </Link>
      </div>
    </main>
  );
}

function JsonLd({
  locale,
  products,
  shop
}: {
  locale: string;
  products: ShopProductsResponse;
  shop: ShopDetail;
}) {
  const localBusiness = {
    "@context": "https://schema.org",
    "@type": "Store",
    address: {
      "@type": "PostalAddress",
      addressLocality: shop.address.city,
      addressRegion: shop.address.state,
      postalCode: shop.address.pincode,
      streetAddress: shop.address.line
    },
    description: metaDescription(shop),
    geo: shop.address.latitude != null && shop.address.longitude != null
      ? {
          "@type": "GeoCoordinates",
          latitude: shop.address.latitude,
          longitude: shop.address.longitude
        }
      : undefined,
    image: shop.bannerUrl ?? shop.imageUrl ?? undefined,
    name: shop.name,
    telephone: shop.phone ?? undefined,
    url: absoluteUrl(canonicalPath(locale, shop.publicId, shop.publicSlug))
  };

  const itemList = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: products.products.map((product, index) => ({
      "@type": "ListItem",
      item: {
        "@type": "Product",
        image: product.imageUrl ?? undefined,
        name: product.name,
        offers: {
          "@type": "Offer",
          availability: product.inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
          price: product.price,
          priceCurrency: "INR"
        }
      },
      position: index + 1
    }))
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(localBusiness) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(itemList) }}
      />
    </>
  );
}

function filtersFromSearchParams(searchParams: Record<string, string | string[] | undefined>): ShopProductsFilters {
  return normalizeProductFilters({
    category: firstParam(searchParams.category),
    limit: Number(firstParam(searchParams.limit)),
    page: Number(firstParam(searchParams.page)),
    q: firstParam(searchParams.q),
    sort: firstParam(searchParams.sort) as ShopProductFiltersSort
  });
}

type ShopProductFiltersSort = ShopProductsFilters["sort"];

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function hasIndexChangingQuery(searchParams: Record<string, string | string[] | undefined>) {
  return ["q", "category", "sort", "page"].some((key) => Boolean(firstParam(searchParams[key])));
}

function metaDescription(shop: ShopDetail) {
  return (shop.description ?? shop.tagline ?? `Shop ${shop.name} on Namastore.`).slice(0, 155);
}

function canonicalPath(locale: string, publicId: string, publicSlug: string) {
  return `/${locale}/shop/${publicId}/${publicSlug}`;
}

function absoluteUrl(path: string) {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "https://lotzi.vercel.app").replace(/\/$/, "");
  return `${base}${path}`;
}

function formatAddress(shop: ShopDetail) {
  return [shop.address.city, shop.address.state].filter(Boolean).join(", ") || "Local store";
}
