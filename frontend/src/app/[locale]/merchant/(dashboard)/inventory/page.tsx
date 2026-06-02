import type { Metadata } from "next";
import { InventoryScreen } from "@/features/merchant-dashboard/screens/inventory/inventory-screen";

export const metadata: Metadata = {
  title: "Inventory | Lotzi",
  description: "Track merchant inventory in Lotzi."
};

export default function MerchantInventoryPage() {
  return <InventoryScreen />;
}
