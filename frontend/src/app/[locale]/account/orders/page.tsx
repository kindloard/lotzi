import type { Metadata } from "next";
import { OrdersScreen } from "@/features/customer-account/screens/orders-screen";

export const metadata: Metadata = {
  title: "Orders | Namastore Account",
  description: "View your Namastore order history.",
  robots: {
    follow: false,
    index: false
  }
};

export default function AccountOrdersPage() {
  return <OrdersScreen />;
}
