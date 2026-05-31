import type { Metadata } from "next";
import { OrdersScreen } from "@/features/merchant-dashboard/screens/orders/orders-screen";

export const metadata: Metadata = {
  title: "Order details | Namastore",
  description: "Review a merchant order in Namastore."
};

export default function MerchantOrderDetailPage() {
  return <OrdersScreen />;
}
