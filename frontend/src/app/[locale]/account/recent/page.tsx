import type { Metadata } from "next";
import { RecentScreen } from "@/features/customer-account/screens/placeholder-screen";

export const metadata: Metadata = {
  title: "Recently Viewed | Namastore Account",
  description: "Review recently viewed Namastore products and shops.",
  robots: {
    follow: false,
    index: false
  }
};

export default function AccountRecentPage() {
  return <RecentScreen />;
}
