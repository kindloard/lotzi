import type { Metadata } from "next";
import { WishlistScreen } from "@/features/customer-account/screens/placeholder-screen";

export const metadata: Metadata = {
  title: "Wishlist | Lotzi Account",
  description: "View your saved Lotzi products.",
  robots: {
    follow: false,
    index: false
  }
};

export default function AccountWishlistPage() {
  return <WishlistScreen />;
}
