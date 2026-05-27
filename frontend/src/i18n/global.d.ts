import { formats } from "./formats";
import { routing } from "./routing";
import admin from "../locales/en/admin.json";
import auth from "../locales/en/auth.json";
import cart from "../locales/en/cart.json";
import common from "../locales/en/common.json";
import dashboard from "../locales/en/dashboard.json";
import errors from "../locales/en/errors.json";
import marketplace from "../locales/en/marketplace.json";
import metadata from "../locales/en/metadata.json";
import onboarding from "../locales/en/onboarding.json";

const messages = {
  admin,
  auth,
  cart,
  common,
  dashboard,
  errors,
  marketplace,
  metadata,
  onboarding
};

declare module "next-intl" {
  interface AppConfig {
    Locale: (typeof routing.locales)[number];
    Messages: typeof messages;
    Formats: typeof formats;
  }
}

