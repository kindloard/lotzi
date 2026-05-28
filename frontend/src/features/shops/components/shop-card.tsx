"use client";

import Image from "next/image";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Heart } from "lucide-react";
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
  const shopDescription =
    shop.branding?.description?.trim() ||
    shop.branding?.tagline?.trim() ||
    `${shop.name} is a local ${shop.typeName.toLowerCase()} store serving your neighborhood.`;
  const viewStoreHref = shouldUseShopPage(shop.id)
    ? `/shop/${shop.publicId}/${shop.publicSlug}`
    : `#shop-${shop.id}`;

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
            className="object-cover"
          />
        ) : (
          <div className={`absolute inset-0 bg-gradient-to-br ${shop.imageBg}`} />
        )}
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
          </div>

          <button
            type="button"
            onClick={() => onToggleFavorite(shop.id)}
            className="flex size-10 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-sm transition-colors hover:border-rose-200 hover:text-rose-600"
            title="Add to favorites"
            aria-label={isFavorite ? `Remove ${shop.name} from favorites` : `Add ${shop.name} to favorites`}
          >
            <Heart
              size={18}
              fill={isFavorite ? "#e11d48" : "none"}
              className={isFavorite ? "text-rose-600" : ""}
            />
          </button>
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

        <div className="px-1">
          <p className="line-clamp-3 text-sm font-medium leading-6 text-slate-700">
            {shopDescription}
          </p>
        </div>

        <div className="pt-1">
          <Link
            href={viewStoreHref}
            className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-black px-4 text-sm font-extrabold text-white transition-opacity hover:opacity-90"
          >
            View Store
            <ChevronRight size={13} className="ml-0.5" />
          </Link>
        </div>
      </div>
    </article>
  );
});

function shouldUseShopPage(shopId: string) {
  const rawPercent = Number(process.env.NEXT_PUBLIC_SHOP_PAGE_ROLLOUT_PERCENT ?? "100");
  const percent = Math.max(0, Math.min(100, Number.isFinite(rawPercent) ? rawPercent : 0));
  return stableHash(shopId) % 100 < percent;
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
