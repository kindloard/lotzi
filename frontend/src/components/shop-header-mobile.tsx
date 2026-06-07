"use client";

import { ArrowLeft, MapPin, ShoppingCart } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useEffect, useState } from "react";
import { useCart } from "@/lib/cart-context";

export function ShopHeaderMobile({
  shopName,
  address,
  typeName,
  backHref = "/"
}: {
  shopName: string;
  address: string;
  typeName?: string;
  backHref?: string;
}) {
  const { cartItemCount } = useCart();
  const tAria = useTranslations("common.aria");
  const tShopHeader = useTranslations("marketplace.shopHeader");
  const normalizedAddress = address.trim() || tShopHeader("fallbackAddress");
  const [index, setIndex] = useState(0);
  const ticks = [normalizedAddress];
  if (typeName) {
    ticks.push(typeName);
  } else {
    ticks.push(tShopHeader("fallbackTagline"));
  }

  useEffect(() => {
    const interval = setInterval(() => {
      setIndex((i) => (i + 1) % ticks.length);
    }, 4000);
    return () => clearInterval(interval);
  }, [ticks.length]);

  return (
    <header className="sticky top-0 z-50 flex h-14 w-full items-center bg-white px-4 border-b border-slate-200 md:hidden gap-3">
      <Link href={backHref} className="flex shrink-0 items-center justify-center text-slate-700 hover:text-slate-950 transition-colors cursor-pointer py-2 pr-2">
        <ArrowLeft size={24} strokeWidth={2.5} />
      </Link>
      <div className="flex min-w-0 flex-1 flex-col justify-center">
        <div className="flex items-center">
          <span className="block truncate text-[16px] font-black tracking-tight text-slate-950">
            {shopName}
          </span>
        </div>
        <div className="relative h-[16px] w-full overflow-hidden mt-0.5">
          <div
            className="absolute left-0 top-0 flex flex-col transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]"
            style={{ transform: `translateY(-${index * 16}px)` }}
          >
            {ticks.map((tick, i) => (
              <span key={i} className="flex h-[16px] items-center gap-1 text-[11px] font-medium text-slate-600 truncate">
                {i === 0 ? <MapPin size={10} className="shrink-0" /> : null}
                {tick}
              </span>
            ))}
          </div>
        </div>
      </div>
      <Link
        href="/cart"
        aria-label={tAria("openCart")}
        className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-900"
      >
        <ShoppingCart size={18} strokeWidth={2.3} />
        {cartItemCount > 0 ? (
          <span className="absolute -right-1.5 -top-1.5 flex min-w-[18px] items-center justify-center rounded-full bg-brand px-1 text-[10px] font-black leading-[18px] text-slate-900">
            {cartItemCount > 99 ? "99+" : cartItemCount}
          </span>
        ) : null}
      </Link>
    </header>
  );
}
