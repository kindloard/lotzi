import type { Metadata } from "next";
import { OrdersScreen } from "@/features/merchant-dashboard/screens/orders/orders-screen";

export const metadata: Metadata = {
  title: "Orders | Namastore",
  description: "Manage merchant orders in Namastore."
};

export default function MerchantOrdersPage() {
  return <OrdersScreen />;
}
