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
    () =>
      optimizedCloudinaryUrl(shop.bannerUrl, {
        width: priority ? 960 : 720,
        crop: "limit",
        quality: "auto",
        format: "auto",
        trim: 10
      }),
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
      className="relative flex flex-col overflow-hidden rounded-[20px] border border-neutral-200 bg-white"
      style={{ contentVisibility: "auto", containIntrinsicSize: "285px" }}
    >
      <div className="relative w-full overflow-hidden rounded-t-[20px] bg-neutral-100 aspect-[21/9] sm:aspect-[2.5/1]">
        {bannerUrl && shouldRenderMedia ? (
          <>
            <Image
              src={bannerUrl}
              alt={`${shop.name} banner`}
              fill
              priority={priority}
              sizes="(max-width: 768px) 100vw, 440px"
              placeholder="blur"
              blurDataURL={blurDataUrl("#ecfdf5")}
              className="object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-black/5 to-transparent opacity-80" />
          </>
        ) : (
          <div className={`absolute inset-0 bg-gradient-to-br ${shop.imageBg}`} />
        )}
        
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            onToggleFavorite(shop.id);
          }}
          className="absolute right-3 top-3 z-10 flex size-9 items-center justify-center rounded-full bg-white/90 text-black shadow-sm backdrop-blur-md active:scale-95"
          title="Add to favorites"
          aria-label={isFavorite ? `Remove ${shop.name} from favorites` : `Add ${shop.name} to favorites`}
        >
          <Heart
            size={18}
            fill={isFavorite ? "#f43f5e" : "none"}
            className={isFavorite ? "text-rose-500" : "text-black"}
          />
        </button>
      </div>

      <div className="flex flex-1 flex-col justify-between gap-3 p-4 pt-0">
        <div className="flex items-start gap-3">
          <div className="z-10 -mt-6 rounded-full bg-white p-1 shadow-sm">
            <span className="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-full border border-neutral-100 bg-neutral-50 text-sm font-bold text-black">
              {logoUrl && shouldRenderMedia ? (
                <Image
                  src={logoUrl}
                  alt={`${shop.name} logo`}
                  fill
                  sizes="56px"
                  placeholder="blur"
                  blurDataURL={blurDataUrl("#f8fafc")}
                  className="object-cover"
                />
              ) : (
                shop.initials
              )}
            </span>
          </div>

          <div className="min-w-0 flex-1 pt-2">
            <h4 className="truncate text-lg font-bold tracking-tight text-neutral-900">
              {shop.name}
            </h4>
          </div>
        </div>

        <div>
          <p className="line-clamp-2 text-sm font-medium leading-relaxed text-neutral-500">
            {shopDescription}
          </p>
        </div>

        <div className="mt-2">
          <Link
            href={viewStoreHref}
            className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-neutral-900 px-4 text-sm font-bold text-white active:scale-[0.98]"
          >
            View Store
            <ChevronRight size={16} className="ml-1 opacity-70" />
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
