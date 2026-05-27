import type { Metadata } from "next";
import { AdminMerchantApprovalsScreen } from "@/features/admin/merchant-approvals/admin-merchant-approvals-screen";

export const metadata: Metadata = {
  title: "Merchant approvals | Namastore admin",
  description: "Approve submitted Namastore merchant applications."
};

export default function AdminMerchantApprovalsPage() {
  return <AdminMerchantApprovalsScreen />;
}
