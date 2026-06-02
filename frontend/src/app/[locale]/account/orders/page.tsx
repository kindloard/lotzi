import type { Metadata } from "next";
import { OrdersScreen } from "@/features/customer-account/screens/orders-screen";

export const metadata: Metadata = {
  title: "Orders | Lotzi Account",
  description: "View your Lotzi order history.",
  robots: {
    follow: false,
    index: false
  }
};

export default function AccountOrdersPage() {
  return <OrdersScreen />;
}
