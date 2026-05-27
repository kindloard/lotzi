import type { Metadata } from "next";
import { InventoryScreen } from "@/features/merchant-dashboard/screens/inventory/inventory-screen";

export const metadata: Metadata = {
  title: "Inventory | Namastore",
  description: "Track merchant inventory in Namastore."
};

export default function MerchantInventoryPage() {
  return <InventoryScreen />;
}
