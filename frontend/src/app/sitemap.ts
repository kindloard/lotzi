import type { MetadataRoute } from "next";
import { routing } from "@/i18n/routing";

const publicPaths = [
  "",
  "/auth/login",
  "/auth/signup",
  "/auth/merchant/signup",
  "/auth/otp",
  "/cart"
];

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? "https://namastore.app";

  return routing.locales.flatMap((locale) =>
    publicPaths.map((path) => ({
      alternates: {
        languages: {
          en: `${origin}/en${path}`,
          ta: `${origin}/ta${path}`,
          "x-default": `${origin}/en${path}`
        }
      },
      changeFrequency: path ? "weekly" : "daily",
      lastModified: new Date(),
      priority: path ? 0.7 : 1,
      url: `${origin}/${locale}${path}`
    }))
  );
}
