import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getLegacyShopDetailForRedirect, ShopPageFetchError } from "@/features/shops/api/server-shops";

type LegacyShopPageProps = {
  params: Promise<{ locale: string; slug: string }>;
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata(): Promise<Metadata> {
  return {
    robots: {
      follow: true,
      index: false
    },
    title: "Redirecting store | Lotzi"
  };
}

export default async function LegacyShopRedirectPage({ params }: LegacyShopPageProps) {
  const { locale, slug } = await params;

  try {
    const shop = await getLegacyShopDetailForRedirect(slug);
    redirect(`/${locale}/shop/${shop.publicId}/${shop.publicSlug}`);
  } catch (error) {
    if (error instanceof ShopPageFetchError && (error.status === 404 || error.status === 410)) {
      notFound();
    }
    throw error;
  }
}
