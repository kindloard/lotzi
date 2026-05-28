import type { MetadataRoute } from "next";
import { getShopProductsForPage, getShopsForLanding } from "@/features/shops/api/server-shops";
import { routing } from "@/i18n/routing";
import { productRefFromParts } from "@/features/shops/lib/product-route";

const publicPaths = [
  "",
  "/auth/login",
  "/auth/signup",
  "/auth/merchant/signup",
  "/auth/otp",
  "/cart"
];

export const revalidate = 300;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = (process.env.NEXT_PUBLIC_APP_URL ?? "https://lotzi.vercel.app").replace(/\/$/, "");
  const shops = await getShopsForLanding();
  const productRows = await Promise.all(
    shops.map(async (shop) => {
      const result = await getShopProductsForPage(shop.publicId, shop.publicSlug, { limit: 24, page: 1 });
      return {
        shop,
        products: result.data.products
      };
    })
  );

  const staticRoutes = routing.locales.flatMap((locale) =>
    publicPaths.map((path) => ({
      alternates: {
        languages: {
          en: `${origin}/en${path}`,
          ta: `${origin}/ta${path}`,
          "x-default": `${origin}/en${path}`
        }
      },
      changeFrequency: path ? "weekly" as const : "daily" as const,
      lastModified: new Date(),
      priority: path ? 0.7 : 1,
      url: `${origin}/${locale}${path}`
    }))
  );

  const shopRoutes = routing.locales.flatMap((locale) =>
    shops.map((shop) => ({
      alternates: {
        languages: {
          en: `${origin}/en/shop/${shop.publicId}/${shop.publicSlug}`,
          ta: `${origin}/ta/shop/${shop.publicId}/${shop.publicSlug}`,
          "x-default": `${origin}/en/shop/${shop.publicId}/${shop.publicSlug}`
        }
      },
      changeFrequency: "hourly" as const,
      lastModified: new Date(),
      priority: 0.8,
      url: `${origin}/${locale}/shop/${shop.publicId}/${shop.publicSlug}`
    }))
  );

  const productRoutes = routing.locales.flatMap((locale) =>
    productRows.flatMap(({ shop, products }) =>
      products.map((product) => {
        const productRef = productRefFromParts(product.publicId, product.slug);
        const route = `${origin}/${locale}/shop/${shop.publicId}/${shop.publicSlug}/product/${productRef}`;
        return {
          alternates: {
            languages: {
              en: `${origin}/en/shop/${shop.publicId}/${shop.publicSlug}/product/${productRef}`,
              ta: `${origin}/ta/shop/${shop.publicId}/${shop.publicSlug}/product/${productRef}`,
              "x-default": `${origin}/en/shop/${shop.publicId}/${shop.publicSlug}/product/${productRef}`
            }
          },
          changeFrequency: "daily" as const,
          lastModified: new Date(),
          priority: 0.75,
          url: route
        };
      })
    )
  );

  return [...staticRoutes, ...shopRoutes, ...productRoutes];
}
