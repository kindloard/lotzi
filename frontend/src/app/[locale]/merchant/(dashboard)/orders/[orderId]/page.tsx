import type { Metadata } from "next";
import { OrdersScreen } from "@/features/merchant-dashboard/screens/orders/orders-screen";

export const metadata: Metadata = {
  title: "Order details | Lotzi",
  description: "Review a merchant order in Lotzi."
};

export default function MerchantOrderDetailPage() {
  return <OrdersScreen />;
}
