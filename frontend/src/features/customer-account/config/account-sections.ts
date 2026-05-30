import {
  Heart,
  Home,
  MapPin,
  Package,
  User
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type AccountSectionId =
  | "profile"
  | "addresses"
  | "orders"
  | "wishlist"
  | "payments"
  | "settings"
  | "security"
  | "recent"
  | "recommendations";

export type AccountNavId = "home" | AccountSectionId;

export interface AccountSectionItem {
  id: AccountSectionId;
  label: string;
  shortLabel: string;
  description: string;
  eyebrow: string;
  href: `/account/${AccountSectionId}`;
  icon: LucideIcon;
}

export const accountSections: AccountSectionItem[] = [
  {
    id: "profile",
    label: "Profile",
    shortLabel: "Profile",
    description: "Name, avatar, phone, and account contact details.",
    eyebrow: "Identity",
    href: "/account/profile",
    icon: User
  },
  {
    id: "addresses",
    label: "Addresses",
    shortLabel: "Addresses",
    description: "Delivery addresses, default location, and checkout details.",
    eyebrow: "Delivery",
    href: "/account/addresses",
    icon: MapPin
  },
  {
    id: "orders",
    label: "Orders",
    shortLabel: "Orders",
    description: "Current and past Namastore purchases.",
    eyebrow: "Purchases",
    href: "/account/orders",
    icon: Package
  },
  {
    id: "wishlist",
    label: "Wishlist",
    shortLabel: "Wishlist",
    description: "Products saved for later shopping.",
    eyebrow: "Saved",
    href: "/account/wishlist",
    icon: Heart
  },
  /*
  {
    id: "payments",
    label: "Payments",
    shortLabel: "Payments",
    description: "Saved payment methods and checkout preferences.",
    eyebrow: "Billing",
    href: "/account/payments",
    icon: CreditCard
  },
  {
    id: "settings",
    label: "Settings",
    shortLabel: "Settings",
    description: "Preferences, notifications, and account defaults.",
    eyebrow: "Preferences",
    href: "/account/settings",
    icon: Settings
  },
  {
    id: "security",
    label: "Security",
    shortLabel: "Security",
    description: "Password, email changes, sessions, and account deletion.",
    eyebrow: "Trust",
    href: "/account/security",
    icon: ShieldCheck
  },
  {
    id: "recent",
    label: "Recently viewed",
    shortLabel: "Recent",
    description: "Products and shops you checked recently.",
    eyebrow: "History",
    href: "/account/recent",
    icon: Clock3
  },
  {
    id: "recommendations",
    label: "For you",
    shortLabel: "For you",
    description: "Personalized shopping recommendations.",
    eyebrow: "Personalized",
    href: "/account/recommendations",
    icon: Sparkles
  }
  */
];

export const accountHomeNav = {
  id: "home" as const,
  label: "Account",
  shortLabel: "Home",
  description: "Your Namastore account hub.",
  eyebrow: "Overview",
  href: "/account" as const,
  icon: Home
};

export const primaryMobileSections: AccountNavId[] = ["home", "profile", "orders", "addresses"];

export function isAccountSectionId(value: string | null | undefined): value is AccountSectionId {
  return accountSections.some((section) => section.id === value);
}

export function getAccountSection(id: AccountSectionId | null | undefined) {
  return id ? accountSections.find((section) => section.id === id) ?? null : null;
}

export function accountSectionFromPath(pathname: string | null | undefined): AccountSectionId | null {
  const segments = pathname?.split("/").filter(Boolean) ?? [];
  const accountIndex = segments.lastIndexOf("account");
  const section = accountIndex >= 0 ? segments[accountIndex + 1] : null;
  return isAccountSectionId(section) ? section : null;
}
