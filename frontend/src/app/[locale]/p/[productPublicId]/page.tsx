import { notFound, redirect } from "next/navigation";
import { getProductRouteForShortLink, ShopPageFetchError } from "@/features/shops/api/server-shops";

type ProductShortLinkPageProps = {
  params: Promise<{ locale: string; productPublicId: string }>;
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ProductShortLinkPage({ params }: ProductShortLinkPageProps) {
  const { locale, productPublicId } = await params;
  try {
    const route = await getProductRouteForShortLink(productPublicId);
    redirect(`/${locale}${route.canonicalPath}`);
  } catch (error) {
    if (error instanceof ShopPageFetchError && (error.status === 404 || error.status === 410)) {
      notFound();
    }
    throw error;
  }
}
