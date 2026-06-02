import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? "https://lotzi.app";

  return {
    rules: {
      allow: "/",
      disallow: ["/api/", "/_next/"]
    },
    sitemap: `${origin}/sitemap.xml`
  };
}
