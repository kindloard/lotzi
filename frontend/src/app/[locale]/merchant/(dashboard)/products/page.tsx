import type { Metadata } from "next";
import { ProductsScreen } from "@/features/merchant-dashboard/screens/products/products-screen";

export const metadata: Metadata = {
  title: "Products | Namastore",
  description: "Manage merchant products in Namastore."
};

export default function MerchantProductsPage() {
  return <ProductsScreen />;
}
