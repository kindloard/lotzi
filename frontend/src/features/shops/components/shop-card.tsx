"use client";

import Image from "next/image";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Clock, Heart, Star, Truck } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { blurDataUrl, optimizedCloudinaryUrl } from "../lib/image-utils";
import type { Shop } from "../shops-api";

interface ShopCardProps {
  shop: Shop;
  isFavorite: boolean;
  onToggleFavorite: (shopId: string) => void;
  priority?: boolean;
}

export const ShopCard = memo(function ShopCard({
  shop,
  isFavorite,
  onToggleFavorite,
  priority = false
}: ShopCardProps) {
  const cardRef = useRef<HTMLElement | null>(null);
  const [shouldRenderMedia, setShouldRenderMedia] = useState(priority);

  useEffect(() => {
    if (priority || shouldRenderMedia || !cardRef.current || !("IntersectionObserver" in window)) {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setShouldRenderMedia(true);
          observer.disconnect();
        }
      },
      { rootMargin: "500px 0px" }
    );

    observer.observe(cardRef.current);
    return () => observer.disconnect();
  }, [priority, shouldRenderMedia]);

  const bannerUrl = useMemo(
    () => optimizedCloudinaryUrl(shop.bannerUrl, { width: priority ? 720 : 480 }),
    [priority, shop.bannerUrl]
  );
  const logoUrl = useMemo(
    () => optimizedCloudinaryUrl(shop.logoUrl, { width: 96 }),
    [shop.logoUrl]
  );

  return (
    <article
      ref={cardRef}
      className="group relative flex min-h-[380px] flex-col overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-sm transition-shadow duration-200 hover:shadow-md"
      style={{ contentVisibility: "auto", containIntrinsicSize: "380px" }}
    >
      <div className="relative h-36 w-full overflow-hidden bg-slate-100 shadow-inner">
        {bannerUrl && shouldRenderMedia ? (
          <Image
            src={bannerUrl}
            alt={`${shop.name} banner`}
            fill
            priority={priority}
            sizes="(max-width: 768px) 100vw, 33vw"
            placeholder="blur"
            blurDataURL={blurDataUrl("#ecfdf5")}
            className="object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          />
        ) : (
          <div className={`absolute inset-0 bg-gradient-to-br ${shop.imageBg}`} />
        )}

        <button
          type="button"
          onClick={() => onToggleFavorite(shop.id)}
          className="absolute right-3.5 top-3.5 z-10 flex size-8 items-center justify-center rounded-full bg-white/90 text-slate-700 shadow-md transition-all hover:bg-white hover:text-rose-600"
          title="Add to favorites"
          aria-label={isFavorite ? `Remove ${shop.name} from favorites` : `Add ${shop.name} to favorites`}
        >
          <Heart
            size={14}
            fill={isFavorite ? "#e11d48" : "none"}
            className={isFavorite ? "text-rose-600" : ""}
          />
        </button>
      </div>

      <div className="flex flex-1 flex-col justify-between space-y-4 p-5">
        <div className="flex items-center gap-3">
          <span className="relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-100 bg-white text-xs font-black text-slate-900 shadow-md">
            {logoUrl && shouldRenderMedia ? (
              <Image
                src={logoUrl}
                alt={`${shop.name} logo`}
                fill
                sizes="48px"
                placeholder="blur"
                blurDataURL={blurDataUrl("#f8fafc")}
                className="object-cover"
              />
            ) : (
              shop.initials
            )}
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="truncate text-sm font-extrabold leading-tight text-slate-950">
                {shop.name}
              </h4>
              <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-600">
                {shop.typeName}
              </span>
            </div>
            <p
              className="mt-1 text-xs leading-none text-slate-500"
              title={distanceTitle(shop)}
            >
              {shop.distanceSource === "google_road" && shop.durationText
                ? `${shop.distance} road - ${shop.durationText}`
                : shop.distance}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {shop.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-md border border-slate-100 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-500"
            >
              {tag}
            </span>
          ))}
        </div>

        <div className="grid grid-cols-3 gap-2 rounded-2xl border-y border-slate-100 bg-slate-50/50 py-3 text-center">
          <div>
            <p className="flex items-center justify-center gap-0.5 text-xs font-bold text-slate-900">
              <Star size={12} className="text-amber-500" fill="#f59e0b" />
              {shop.rating}
            </p>
            <p className="mt-0.5 text-[9px] text-slate-400">{shop.reviews}</p>
          </div>
          <div className="border-x border-slate-200/60">
            <p className="flex items-center justify-center gap-0.5 text-xs font-bold text-slate-900">
              <Clock size={12} className="text-slate-500" />
              {shop.deliveryTime}
            </p>
            <p className="mt-0.5 text-[9px] text-slate-400">Delivery</p>
          </div>
          <div>
            <p className="flex items-center justify-center gap-0.5 text-xs font-bold text-slate-900">
              <Truck size={12} className="text-slate-500" />
              {shop.deliveryFee}
            </p>
            <p className="mt-0.5 text-[9px] text-slate-400">Fee</p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 pt-1">
          <span className="min-w-0 truncate text-[10px] font-medium text-slate-500">
            Featured: <strong className="font-bold text-slate-800">{shop.featuredProduct}</strong>
          </span>
          <Link
            href={`#shop-${shop.id}`}
            className="inline-flex h-9 shrink-0 items-center justify-center rounded-xl bg-slate-900 px-3 text-[11px] font-bold text-white transition-colors hover:bg-slate-800"
          >
            Shop Store
            <ChevronRight size={13} className="ml-0.5" />
          </Link>
        </div>
      </div>
    </article>
  );
});

function distanceTitle(shop: Shop) {
  if (shop.distanceSource === "google_road") {
    return "Google road distance based on your precise location";
  }
  if (shop.distanceSource === "straight_line") {
    return `Approximate straight-line distance${shop.distanceAccuracyMeters ? `; GPS accuracy ${Math.round(shop.distanceAccuracyMeters)} m` : ""}`;
  }
  return "Allow location access to calculate distance";
}
