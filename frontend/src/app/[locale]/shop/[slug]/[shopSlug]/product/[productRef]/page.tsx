import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { ShopHeaderMobile } from "@/components/shop-header-mobile";
import { getShopDetailForPage, getShopProductDetailForPage, ShopPageFetchError } from "@/features/shops/api/server-shops";
import { parseProductRefSegment, productRefFromParts } from "@/features/shops/lib/product-route";
import { ShopProductDetailView } from "@/features/shops/components/shop-product-detail-view";
import { ShopsQueryProvider } from "@/features/shops/providers/shops-query-provider";

type ProductPageProps = {
  params: Promise<{ locale: string; slug: string; shopSlug: string; productRef: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const revalidate = 120;

export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const { locale, slug, shopSlug, productRef } = await params;

  try {
    const detail = await getShopProductDetailForPage(slug, shopSlug, productRef);
    const canonical = `/${locale}${detail.product.canonicalPath}`;
    return {
      title: `${detail.product.seoTitle} | ${detail.store.name} | Namastore`,
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
        title: "Product unavailable | Namastore"
      };
    }
    return {
      title: "Product | Namastore"
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
  const shopForHeader = await getShopDetailForPage(detail.store.publicId, detail.store.publicSlug).catch(() => null);
  const headerAddress = formatShopHeaderAddress(shopForHeader);
  const storePath = `/shop/${detail.store.publicId}/${detail.store.publicSlug}`;

  return (
    <main className="min-h-screen bg-white pb-32 text-slate-950 md:pb-12">
      <ShopHeaderMobile
        shopName={detail.store.name}
        address={headerAddress}
        typeName={detail.store.typeName}
        backHref={storePath}
      />
      <div className="mx-auto hidden max-w-7xl px-4 py-6 sm:px-6 lg:block lg:px-8">
        <nav aria-label="Breadcrumb" className="text-sm font-semibold text-slate-400">
          <ol className="flex items-center gap-2 min-w-0">
            <li className="shrink-0">
              <Link href={storePath} className="hover:text-slate-900 transition-colors">
                {detail.store.name}
              </Link>
            </li>
            <li aria-hidden="true" className="text-slate-300 shrink-0">/</li>
            <li className="truncate text-slate-900 min-w-0">{detail.product.name}</li>
          </ol>
        </nav>
      </div>
      <ShopsQueryProvider>
        <ShopProductDetailView
          initialImageIndex={initialImageIndex}
          productDetail={detail}
        />
      </ShopsQueryProvider>
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

function formatShopHeaderAddress(shop: Awaited<ReturnType<typeof getShopDetailForPage>> | null) {
  if (!shop) {
    return "";
  }
  return [shop.address.city, shop.address.state].filter(Boolean).join(", ");
}
