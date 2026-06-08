import { Metadata } from "next";

export const metadata: Metadata = {
  title: "POS Terminal | Namastore",
  description: "Point of Sale Terminal",
};

export default function PosLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="pos-layout-root h-screen w-screen overflow-hidden bg-white">
      {/* 
        This layout intentionally omits the standard Merchant Dashboard sidebar 
        and header to give the POS terminal maximum screen real estate.
      */}
      {children}
    </div>
  );
}
