import { defineRouting } from "next-intl/routing";

export const localeCookie = {
  name: "namastore_locale",
  maxAge: 60 * 60 * 24 * 365,
  path: "/",
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production"
};

export const routing = defineRouting({
  locales: ["en", "ta"],
  defaultLocale: "en",
  localePrefix: "always",
  localeDetection: true,
  localeCookie: {
    name: localeCookie.name,
    maxAge: localeCookie.maxAge,
    path: localeCookie.path,
    sameSite: localeCookie.sameSite,
    secure: localeCookie.secure
  }
});

export type AppLocale = (typeof routing.locales)[number];
