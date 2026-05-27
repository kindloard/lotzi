import type { Metadata } from "next";
import { WishlistScreen } from "@/features/customer-account/screens/placeholder-screen";

export const metadata: Metadata = {
  title: "Wishlist | Namastore Account",
  description: "View your saved Namastore products.",
  robots: {
    follow: false,
    index: false
  }
};

export default function AccountWishlistPage() {
  return <WishlistScreen />;
}
