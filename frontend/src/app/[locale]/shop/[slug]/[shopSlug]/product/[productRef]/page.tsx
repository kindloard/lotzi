import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { ShopHeaderMobile } from "@/components/shop-header-mobile";
import { getShopProductDetailForPage, getShopProductsForPage, ShopPageFetchError } from "@/features/shops/api/server-shops";
import { parseProductRefSegment, productRefFromParts } from "@/features/shops/lib/product-route";
import { ShopProductDetailView } from "@/features/shops/components/shop-product-detail-view";
import { StorefrontFooter } from "@/features/shops/components/storefront-footer";
import { ShopsQueryProvider } from "@/features/shops/providers/shops-query-provider";

type ProductPageProps = {
  params: Promise<{ locale: string; slug: string; shopSlug: string; productRef: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const { locale, slug, shopSlug, productRef } = await params;

  try {
    const detail = await getShopProductDetailForPage(slug, shopSlug, productRef);
    const canonical = `/${locale}${detail.product.canonicalPath}`;
    return {
      title: `${detail.product.seoTitle} | ${detail.store.name} | Lotzi`,
      description: detail.product.seoDescription.slice(0, 155),
      alternates: {
        canonical
      },
      openGraph: {
        title: detail.product.seoTitle,
        description: detail.product.seoDescription.slice(0, 155),
        images: detail.product.imageUrl ? [{ url: detail.product.imageUrl }] : [],
        type: "website",
        url: absoluteUrl(canonical)
      },
      twitter: {
        card: "summary_large_image",
        title: detail.product.seoTitle,
        description: detail.product.seoDescription.slice(0, 155),
        images: detail.product.imageUrl ? [detail.product.imageUrl] : []
      }
    };
  } catch (error) {
    if (error instanceof ShopPageFetchError && (error.status === 404 || error.status === 410)) {
      return {
        robots: {
          index: false,
          follow: false
        },
        title: "Product unavailable | Lotzi"
      };
    }
    return {
      title: "Product | Lotzi"
    };
  }
}

export default async function ProductPage({ params, searchParams }: ProductPageProps) {
  const [{ locale, slug, shopSlug, productRef }, rawSearchParams] = await Promise.all([params, searchParams]);
  let detail;
  try {
    detail = await getShopProductDetailForPage(slug, shopSlug, productRef);
  } catch (error) {
    if (error instanceof ShopPageFetchError) {
      if (error.status === 404 || error.status === 410) {
        notFound();
      }
      return (
        <ProductTemporarilyUnavailable
          retryHref={`/${locale}/shop/${slug}/${shopSlug}/product/${productRef}`}
          storeHref={`/shop/${slug}/${shopSlug}`}
        />
      );
    }
    throw error;
  }

  const requested = parseProductRefSegment(productRef);
  const canonicalRef = productRefFromParts(detail.product.publicId, detail.product.slug);
  if (!requested || requested.productPublicId !== detail.product.publicId || canonicalRef !== productRef) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(rawSearchParams)) {
      const first = Array.isArray(value) ? value[0] : value;
      if (typeof first === "string" && first) {
        params.set(key, first);
      }
    }
    const suffix = params.toString() ? `?${params.toString()}` : "";
    redirect(`/${locale}${detail.product.canonicalPath}${suffix}`);
  }

  const requestedImage = firstParam(rawSearchParams.image);
  const initialImageIndex = resolveInitialImageIndex(requestedImage, detail.product.images);
  const headerAddress = formatShopHeaderAddress(detail.store);
  const storePath = `/shop/${detail.store.publicId}/${detail.store.publicSlug}`;

  // Robust waterfall fallback for product discovery (Similar Products & Recommendations)
  // 1. Fetch initial pool from the same category
  const similarProductsRes = await getShopProductsForPage(detail.store.publicId, detail.store.publicSlug, { category: detail.product.categorySlug, limit: 30 });
  let pool = similarProductsRes.data.products.filter(p => p.id !== detail.product.id);

  // 2. If the category is sparse, backfill with store-wide products
  if (pool.length < 10) {
    const storeRes = await getShopProductsForPage(detail.store.publicId, detail.store.publicSlug, { limit: 30 });
    const extra = storeRes.data.products.filter(p => p.id !== detail.product.id && !pool.some(ep => ep.id === p.id));
    pool = [...pool, ...extra];
  }

  // 3. Build 'Similar Products' (Strict: exact productType ONLY)
  const similarMatches = pool.filter(p => p.productType === detail.product.productType);
  const similarProducts = similarMatches.slice(0, 5).map(p => ({
    id: p.id,
    publicId: p.publicId,
    slug: p.slug,
    name: p.name,
    imageUrl: p.imageUrl,
    price: p.price,
    compareAtPrice: p.compareAtPrice,
    unitDisplay: p.unitDisplay,
    description: p.description,
    inStock: p.inStock
  }));

  // 4. Build 'You might also like' (Fallback missing backend recommendations)
  let recommendations = (detail.recommendations || []).map(r => {
    const fullProduct = pool.find(p => p.id === r.id);
    return {
      ...r,
      description: fullProduct ? fullProduct.description : r.description
    };
  });
  if (recommendations.length < 5) {
    const extraRecs = pool.filter(p => 
      !similarProducts.some(s => s.id === p.id) && 
      !recommendations.some(r => r.id === p.id)
    ).map(p => ({
      id: p.id,
      publicId: p.publicId,
      slug: p.slug,
      name: p.name,
      imageUrl: p.imageUrl,
      price: p.price,
      compareAtPrice: p.compareAtPrice,
      unitDisplay: p.unitDisplay,
      description: p.description,
      inStock: p.inStock
    }));
    recommendations = [...recommendations, ...extraRecs].slice(0, 5);
  }
  detail.recommendations = recommendations;
  return (
    <main className="flex min-h-screen flex-col bg-white text-slate-950">
      <div className="flex-1 pb-32 md:pb-12">
        <ShopHeaderMobile
          shopName={detail.store.name}
          address={headerAddress}
          typeName={detail.store.typeName}
          backHref={storePath}
        />
        <div className="mx-auto hidden max-w-7xl px-4 py-6 sm:px-6 lg:block lg:px-8">
        </div>
        <ShopsQueryProvider>
          <ShopProductDetailView
            initialImageIndex={initialImageIndex}
            productDetail={detail}
            similarProducts={similarProducts}
            recommendations={recommendations}
          />
        </ShopsQueryProvider>
      </div>
      <StorefrontFooter compact />
      <ProductJsonLd locale={locale} detail={detail} />
    </main>
  );
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function resolveInitialImageIndex(
  raw: string | undefined,
  images: Array<{ id: string }>
) {
  if (!raw) {
    return 0;
  }

  const asNumber = Number(raw);
  if (Number.isInteger(asNumber) && asNumber >= 0 && asNumber < images.length) {
    return asNumber;
  }

  const indexById = images.findIndex((image) => image.id === raw);
  return indexById >= 0 ? indexById : 0;
}

function ProductJsonLd({
  locale,
  detail
}: {
  locale: string;
  detail: Awaited<ReturnType<typeof getShopProductDetailForPage>>;
}) {
  const payload = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: detail.product.name,
    description: detail.product.seoDescription,
    image: detail.product.images.map((image) => image.url),
    sku: detail.product.publicId,
    category: detail.product.category,
    offers: {
      "@type": "Offer",
      availability: detail.product.inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      price: detail.product.price,
      priceCurrency: "INR",
      url: absoluteUrl(`/${locale}${detail.product.canonicalPath}`)
    },
    brand: {
      "@type": "Brand",
      name: detail.store.name
    }
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(payload) }}
    />
  );
}

function ProductTemporarilyUnavailable({
  retryHref,
  storeHref
}: {
  retryHref: string;
  storeHref: string;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-4 text-center text-slate-950">
      <div className="max-w-md">
        <p className="text-sm font-black uppercase tracking-wide text-slate-400">Product temporarily unavailable</p>
        <h1 className="mt-3 text-3xl font-black tracking-tight">We&apos;re reconnecting to this product</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          The store API is taking longer than usual. Your page is okay, and a retry should load it once the backend responds.
        </p>
        <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <a
            href={retryHref}
            className="inline-flex h-11 items-center justify-center rounded-lg bg-black px-5 text-sm font-black text-white"
          >
            Retry product
          </a>
          <Link
            href={storeHref}
            className="inline-flex h-11 items-center justify-center rounded-lg border border-slate-200 bg-white px-5 text-sm font-black text-slate-950"
          >
            Back to store
          </Link>
        </div>
      </div>
    </main>
  );
}

function absoluteUrl(path: string) {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "https://lotzi.vercel.app").replace(/\/$/, "");
  return `${base}${path}`;
}

function formatShopHeaderAddress(shop: { address?: { city: string | null; state: string | null } }) {
  return [shop.address?.city, shop.address?.state].filter(Boolean).join(", ");
}
