"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { Heart, Minus, Plus } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useCart } from "@/lib/cart-context";
import { Link } from "@/i18n/navigation";
import { ViewImageViewer, type ViewImageItem } from "@/components/view-image-viewer";
import { trackProductView, type ShopProductDetailResponse } from "../shops-api";
import { productRefFromParts } from "../lib/product-route";
import { useShopProductDetail } from "../hooks/use-shop-product-detail";
import { buildSubCategoryLabels, localizeCategoryLabel, localizeSubCategoryLabel } from "../lib/category-labels";
import { useCatalogRealtimeSubscription } from "../realtime/catalog-realtime";

export function ShopProductDetailView({
  initialImageIndex,
  productDetail
}: {
  initialImageIndex: number;
  productDetail: ShopProductDetailResponse;
}) {
  const productRef = productRefFromParts(productDetail.product.publicId, productDetail.product.slug);
  const query = useShopProductDetail(
    productDetail.store.publicId,
    productDetail.store.publicSlug,
    productRef,
    productDetail
  );
  const detail = query.data ?? productDetail;
  useCatalogRealtimeSubscription({
    enabled: true,
    productPublicIds: [detail.product.publicId],
    storePublicId: detail.store.publicId
  });
  const format = useFormatter();
  const tDetail = useTranslations("marketplace.shopProductDetail");
  const tCatalog = useTranslations("marketplace.shopCatalog");
  const tCategories = useTranslations("marketplace.categories");
  const subCategoryLabels = useMemo(() => buildSubCategoryLabels(tCatalog), [tCatalog]);
  const packTypeLabels = useMemo<PackTypeLabels>(() => ({
    bag: tDetail("packTypes.bag"),
    bottle: tDetail("packTypes.bottle"),
    box: tDetail("packTypes.box"),
    bunch: tDetail("packTypes.bunch"),
    bundle: tDetail("packTypes.bundle"),
    can: tDetail("packTypes.can"),
    carton: tDetail("packTypes.carton"),
    jar: tDetail("packTypes.jar"),
    pack: tDetail("packTypes.pack"),
    packet: tDetail("packTypes.packet"),
    pouch: tDetail("packTypes.pouch"),
    sachet: tDetail("packTypes.sachet"),
    set: tDetail("packTypes.set"),
    strip: tDetail("packTypes.strip"),
    tray: tDetail("packTypes.tray"),
    unit: tDetail("packTypes.unit")
  }), [tDetail]);
  const specificationLabels = useMemo<SpecificationLabels>(() => ({
    category: tDetail("specificationLabels.category"),
    pricePerBaseUnit: tDetail("specificationLabels.pricePerBaseUnit"),
    subcategory: tDetail("specificationLabels.subcategory"),
    type: tDetail("specificationLabels.type"),
    unit: tDetail("specificationLabels.unit")
  }), [tDetail]);
  const { addToCart, cartItems, updateQty } = useCart();
  const [activeImageIndex, setActiveImageIndex] = useState(initialImageIndex);
  const [viewerOpen, setViewerOpen] = useState(false);
  const defaultVariantId =
    detail.product.variants.find((variant) => variant.isDefault && variant.inStock && variant.stock > 0)?.id ??
    detail.product.variants.find((variant) => variant.inStock && variant.stock > 0)?.id ??
    detail.product.variants.find((variant) => variant.isDefault)?.id ??
    detail.product.variants[0]?.id ??
    null;
  const [selectedVariantId, setSelectedVariantId] = useState(defaultVariantId);

  const selectedVariant = detail.product.variants.find((variant) => variant.id === selectedVariantId) ?? detail.product.variants[0];
  const displayPrice = selectedVariant?.price ?? detail.product.price;
  const displayCompareAtPrice = selectedVariant?.compareAtPrice ?? detail.product.compareAtPrice;
  const rawDisplayUnit = selectedVariant?.unitDisplay ?? detail.product.unitDisplay;
  const displayUnit = localizeUnitDisplay(rawDisplayUnit, packTypeLabels);
  const displayPricePerBaseUnit = selectedVariant?.pricePerBaseUnitDisplay ?? detail.product.pricePerBaseUnitDisplay;
  const displayStock = selectedVariant?.stock ?? detail.product.stock;
  const displayInStock = Boolean((selectedVariant?.inStock ?? detail.product.inStock) && displayStock > 0);
  const displayCategory = localizeCategoryLabel(detail.product.categorySlug, detail.product.category, tCategories);
  const displaySubCategory = detail.product.subCategory
    ? localizeSubCategoryLabel(detail.product.subCategory, subCategoryLabels)
    : "";
  const displayCategoryPill = displaySubCategory || displayCategory;
  const displaySpecifications = useMemo(() => {
    const specs: Array<{ key: string; label: string; value: string }> = [];
    if (displayCategory) {
      specs.push({ key: "category", label: specificationLabels.category, value: displayCategory });
    }
    if (displaySubCategory) {
      specs.push({ key: "subcategory", label: specificationLabels.subcategory, value: displaySubCategory });
    }
    if (detail.product.productType.trim()) {
      specs.push({ key: "type", label: specificationLabels.type, value: detail.product.productType.trim() });
    }
    if (displayUnit) {
      specs.push({ key: `unit:${selectedVariant?.id ?? "product"}`, label: specificationLabels.unit, value: displayUnit });
    }
    if (displayPricePerBaseUnit) {
      specs.push({
        key: `pricePerBaseUnit:${selectedVariant?.id ?? "product"}`,
        label: specificationLabels.pricePerBaseUnit,
        value: displayPricePerBaseUnit
      });
    }
    return specs;
  }, [detail.product.productType, displayCategory, displayPricePerBaseUnit, displaySubCategory, displayUnit, selectedVariant?.id, specificationLabels]);
  const formatPrice = (value: number) =>
    format.number(value, {
      currency: "INR",
      maximumFractionDigits: value % 1 === 0 ? 0 : 2,
      style: "currency"
    });
  const cartQty = cartItems
    .filter((item) => item.id === detail.product.id && (item.variantId ?? null) === (selectedVariant?.id ?? null))
    .reduce((sum, item) => sum + item.qty, 0);
  const quantityAtLimit = displayInStock && cartQty >= displayStock;

  const discountPercent = displayCompareAtPrice && displayCompareAtPrice > displayPrice
    ? Math.round(((displayCompareAtPrice - displayPrice) / displayCompareAtPrice) * 100)
    : 0;

  const visibleProductImages = useMemo(() => {
    const productLevelImages = detail.product.images.filter((image) => (image.variantIds ?? []).length === 0);
    if (!selectedVariant?.id) {
      return productLevelImages.length ? productLevelImages : detail.product.images;
    }

    const selectedVariantImages = detail.product.images.filter((image) =>
      (image.variantIds ?? []).includes(selectedVariant.id)
    );
    if (selectedVariantImages.length) {
      return selectedVariantImages;
    }

    return productLevelImages.length ? productLevelImages : detail.product.images;
  }, [detail.product.images, selectedVariant?.id]);
  const galleryImages = useMemo<ViewImageItem[]>(
    () => visibleProductImages.map((image) => ({
      id: image.id,
      src: image.url,
      alt: image.altText ?? detail.product.name,
      width: image.width,
      height: image.height
    })),
    [detail.product.name, visibleProductImages]
  );
  const galleryImageKey = useMemo(() => galleryImages.map((image) => image.id).join("|"), [galleryImages]);

  useEffect(() => {
    const eventId = typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `evt_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    void trackProductView(detail.product.publicId, {
      eventId,
      viewedAt: new Date().toISOString()
    });
  }, [detail.product.publicId]);

  useEffect(() => {
    if (!detail.product.variants.some((variant) => variant.id === selectedVariantId)) {
      setSelectedVariantId(defaultVariantId);
    }
  }, [defaultVariantId, detail.product.variants, selectedVariantId]);

  useEffect(() => {
    setActiveImageIndex(0);
  }, [galleryImageKey, selectedVariant?.id]);

  const activeImage = galleryImages[activeImageIndex] ?? galleryImages[0];

  function addCurrentVariantToCart() {
    if (!selectedVariant || !displayInStock || quantityAtLimit) {
      return;
    }
    addToCart({
      id: detail.product.id,
      variantId: selectedVariant?.id,
      name: detail.product.name,
      price: displayPrice,
      shop: detail.store.name,
      shopId: detail.store.id,
      imageBg: "bg-slate-50 text-slate-900",
      imageInitials: detail.product.imageInitials,
      imageUrl: activeImage?.src ?? detail.product.imageUrl ?? undefined,
      unit: rawDisplayUnit,
      unitDisplay: rawDisplayUnit,
      pricePerBaseUnitDisplay: displayPricePerBaseUnit
    });
  }

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
      <div className="lg:grid lg:grid-cols-[1.2fr_1fr] lg:gap-x-12 xl:gap-x-16">
        {/* Left Column - Images */}
        <div className="min-w-0 gap-3 sm:gap-4 lg:flex lg:flex-row lg:gap-6">
          {/* Main Image */}
          <button
            type="button"
            className="relative mt-2 block aspect-square w-full overflow-hidden rounded-2xl bg-slate-50/80 sm:mt-0 sm:rounded-3xl"
            onClick={() => setViewerOpen(true)}
          >
            {activeImage ? (
              <Image
                src={activeImage.src}
                alt={activeImage.alt}
                fill
                priority
                sizes="(max-width: 1024px) 100vw, 60vw"
                className="object-contain p-4 mix-blend-multiply sm:p-8"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-4xl font-black text-slate-300">
                {detail.product.imageInitials}
              </div>
            )}
          </button>

          {/* Thumbnails (Left on Desktop, Bottom on Mobile) */}
          {galleryImages.length > 0 ? (
            <div className="scrollbar-hide flex snap-x snap-mandatory gap-2.5 overflow-x-auto px-2 py-2 lg:flex-col lg:overflow-visible lg:px-0 lg:py-0">
              {galleryImages.map((image, index) => (
                <button
                  key={image.id}
                  type="button"
                  className={`relative h-16 w-16 shrink-0 snap-start overflow-hidden rounded-xl border transition-all duration-200 sm:h-20 sm:w-20 sm:rounded-2xl lg:h-24 lg:w-24 ${
                    index === activeImageIndex 
                      ? "border-2 border-black opacity-100"
                      : "border-slate-200 opacity-70"
                  }`}
                  onClick={() => setActiveImageIndex(index)}
                >
                  <Image src={image.src} alt={image.alt} fill sizes="96px" className="object-cover" />
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {/* Right Column - Product Details (Sticky) */}
        <div className="mt-6 h-fit lg:sticky lg:top-8 lg:mt-0">
          <div className="space-y-6 sm:space-y-8">
            {/* Header section */}
            <div>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="inline-flex max-w-full items-center truncate rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-black">
                  {displayCategoryPill}
                </span>
                {discountPercent > 0 && (
                  <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-800 shrink-0">
                    {tDetail("savePercent", { percent: discountPercent })}
                  </span>
                )}
              </div>
              <h1 className="break-words text-2xl font-black leading-tight tracking-tight text-black sm:text-3xl lg:text-4xl">
                {detail.product.name}
              </h1>
            </div>

            {/* Price section */}
            <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
              <span className="text-3xl font-black tracking-tight text-black sm:text-4xl">
                {formatPrice(displayPrice)}
              </span>
              {displayCompareAtPrice && displayCompareAtPrice > displayPrice ? (
                <span className="mb-1 text-base font-bold text-slate-400 line-through sm:text-lg">
                  {formatPrice(displayCompareAtPrice)}
                </span>
              ) : null}
              <span className="mb-1 text-xs font-semibold text-slate-500 sm:mb-2 sm:ml-1 sm:text-sm">
                / {displayUnit}
              </span>
            </div>

            <div className="h-px bg-slate-100" />

            {/* Variants */}
            {detail.product.variants.length > 1 ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-black">{tDetail("selectOption")}</h3>
                </div>
                <div className="flex flex-wrap gap-2.5 sm:gap-3">
                  {detail.product.variants.map((variant) => (
                    <VariantOptionButton
                      key={variant.id}
                      isActive={selectedVariantId === variant.id}
                      onClick={() => setSelectedVariantId(variant.id)}
                      optionLabel={getVariantPackLabel(variant.unitDisplay, variant.name, packTypeLabels)}
                    />
                  ))}
                </div>
              </div>
            ) : null}

            {/* Actions */}
            <div className="space-y-4 pt-2">
              <div className="flex items-center gap-2">
                <div className={`h-2.5 w-2.5 rounded-full ${displayInStock ? "bg-emerald-500" : "bg-rose-500"}`} />
                <span className={`text-sm font-bold ${displayInStock ? "text-emerald-700" : "text-rose-600"}`}>
                  {displayInStock ? tDetail("inStock") : tDetail("outOfStock")}
                </span>
              </div>

              <div className="hidden items-center gap-3 md:flex lg:gap-4">
                {cartQty > 0 ? (
                  <div className="flex h-14 w-40 items-center justify-between rounded-2xl bg-slate-100 px-2 text-slate-900 border border-slate-200">
                    <button type="button" className="h-10 w-10 flex items-center justify-center rounded-xl bg-white shadow-sm transition-colors" aria-label={tDetail("decreaseQuantity")} onClick={() => updateQty(selectedVariant?.id ?? detail.product.id, -1)}>
                      <Minus size={18} className="text-slate-600" />
                    </button>
                    <span className="text-lg font-black w-8 text-center">{cartQty}</span>
                    <button
                      type="button"
                      className="h-10 w-10 flex items-center justify-center rounded-xl bg-white shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                      aria-label={tDetail("increaseQuantity")}
                      disabled={quantityAtLimit}
                      onClick={addCurrentVariantToCart}
                    >
                      <Plus size={18} className="text-slate-600" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={addCurrentVariantToCart}
                    disabled={!displayInStock}
                    className="flex-1 h-14 rounded-2xl bg-black text-base font-black text-white shadow-[0_8px_20px_rgb(0,0,0,0.12)] transition-all active:translate-y-0 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {tDetail("addToCart")}
                  </button>
                )}
                <button type="button" aria-label={tDetail("favorite")} className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-600 transition-colors">
                  <Heart size={22} />
                </button>
              </div>
            </div>

          </div>
        </div>
      </div>

      {/* Description & Specs Section */}
      <div className="mt-12 max-w-4xl lg:mt-20">
        <div className="space-y-10 sm:space-y-12">
          {detail.product.description && (
            <section>
              <h2 className="mb-4 text-xl font-black text-black sm:mb-6 sm:text-2xl">{tDetail("aboutItem")}</h2>
              <div className="prose prose-slate prose-p:leading-relaxed prose-p:text-slate-600 max-w-none break-words overflow-hidden">
                <p>{detail.product.description}</p>
              </div>
            </section>
          )}

          {displaySpecifications.length > 0 && (
            <section>
              <h2 className="mb-4 text-xl font-black text-black sm:mb-6 sm:text-2xl">{tDetail("specifications")}</h2>
              <div className="divide-y divide-slate-100 border-y border-slate-100">
                {displaySpecifications.map((spec) => (
                  <div key={spec.key} className="flex py-4">
                    <dt className="w-[42%] pr-4 text-sm font-bold text-slate-500 break-words sm:w-1/4">
                      {spec.label}
                    </dt>
                    <dd className="text-sm font-semibold text-slate-900 break-words">
                      {spec.value}
                    </dd>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>

      {/* Related Products */}
      {detail.recommendations.length ? (
        <section className="mt-14 lg:mt-20">
          <div className="mb-5">
            <h2 className="text-xl font-black text-black sm:text-2xl">{tDetail("youMightAlsoLike")}</h2>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-5 xl:gap-6">
            {detail.recommendations.map((item) => (
              <article key={item.id} className="overflow-hidden rounded-2xl border border-slate-100 bg-white p-2.5 sm:p-3">
                <Link
                  href={`/shop/${detail.store.publicId}/${detail.store.publicSlug}/product/${productRefFromParts(item.publicId, item.slug)}`}
                  className="block"
                >
                  <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-slate-50">
                    {item.imageUrl ? (
                      <Image
                        src={item.imageUrl}
                        alt={item.name}
                        fill
                        sizes="(max-width: 768px) 50vw, 20vw"
                        className="object-contain p-3 mix-blend-multiply"
                      />
                    ) : null}
                  </div>
                  <div className="mt-3 space-y-1.5">
                    <h3 className="line-clamp-2 text-sm font-bold text-black break-words">
                      {item.name}
                    </h3>
                    <p className="text-sm font-black text-black">
                      {formatPrice(item.price)}
                    </p>
                  </div>
                </Link>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {/* Mobile Sticky Add to Cart */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white px-3 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] shadow-[0_-8px_30px_-15px_rgba(0,0,0,0.15)] md:hidden">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <div className="flex-shrink-0 min-w-0">
            <p className="text-xs font-bold text-slate-500 truncate">{displayUnit}</p>
            <p className="text-lg font-black text-black truncate">{formatPrice(displayPrice)}</p>
          </div>
          <div className="flex min-w-0 flex-1 justify-end">
            {cartQty > 0 ? (
              <div className="flex h-12 w-full max-w-[13rem] items-center justify-between rounded-xl border border-slate-200 bg-slate-100 px-1.5 text-slate-900">
                <button type="button" className="h-9 w-10 flex items-center justify-center rounded-lg bg-white shadow-sm shrink-0" aria-label={tDetail("decreaseQuantity")} onClick={() => updateQty(selectedVariant?.id ?? detail.product.id, -1)}>
                  <Minus size={16} className="text-slate-600" />
                </button>
                <span className="text-base font-black truncate px-1">{cartQty}</span>
                <button
                  type="button"
                  className="h-9 w-10 flex items-center justify-center rounded-lg bg-white shadow-sm shrink-0 disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label={tDetail("increaseQuantity")}
                  disabled={quantityAtLimit}
                  onClick={addCurrentVariantToCart}
                >
                  <Plus size={16} className="text-slate-600" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={addCurrentVariantToCart}
                disabled={!displayInStock}
                className="h-12 min-w-[9.5rem] rounded-xl bg-black px-4 text-sm font-black text-white transition-transform active:scale-95 disabled:opacity-50"
              >
                {tDetail("addToCart")}
              </button>
            )}
          </div>
        </div>
      </div>

      {viewerOpen ? (
        <ViewImageViewer
          images={galleryImages}
          initialIndex={activeImageIndex}
          isOpen={viewerOpen}
          onClose={() => setViewerOpen(false)}
          title={detail.product.name}
        />
      ) : null}
    </div>
  );
}

function VariantOptionButton({
  isActive,
  onClick,
  optionLabel
}: {
  isActive: boolean;
  onClick: () => void;
  optionLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-11 shrink-0 items-center rounded-xl border-2 px-4 text-sm font-bold leading-none whitespace-nowrap transition-all duration-200 ${
        isActive
          ? "border-black bg-black text-white shadow-md scale-[1.02]"
          : "border-slate-100 bg-white text-black"
      }`}
    >
      {optionLabel}
    </button>
  );
}

const PACK_TYPE_SUFFIX_KEYS = {
  bag: "bag",
  bottle: "bottle",
  box: "box",
  bunch: "bunch",
  bundle: "bundle",
  can: "can",
  carton: "carton",
  jar: "jar",
  pack: "pack",
  packet: "packet",
  pouch: "pouch",
  sachet: "sachet",
  set: "set",
  strip: "strip",
  tray: "tray",
  unit: "unit"
} as const;

type PackTypeKey = typeof PACK_TYPE_SUFFIX_KEYS[keyof typeof PACK_TYPE_SUFFIX_KEYS];
type PackTypeLabels = Record<PackTypeKey, string>;

type SpecificationLabels = {
  category: string;
  pricePerBaseUnit: string;
  subcategory: string;
  type: string;
  unit: string;
};

function getVariantPackLabel(unitDisplay: string, variantName: string, labels: PackTypeLabels) {
  const localizedUnit = localizeUnitDisplay(unitDisplay, labels);
  if (localizedUnit) {
    return localizedUnit;
  }
  const nameMatch = extractMeasurement(variantName);
  if (nameMatch) {
    return `${nameMatch} ${labels.pack}`;
  }
  const fallback = variantName.trim();
  return fallback ? `${fallback} ${labels.pack}` : labels.pack;
}

function localizeUnitDisplay(value: string, labels: PackTypeLabels) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  const match = trimmed.match(/^(.*\S)\s+(Unit|Pack|Packet|Box|Carton|Bottle|Pouch|Jar|Can|Sachet|Strip|Bag|Tray|Bunch|Bundle|Set)$/i);
  if (!match?.[1] || !match[2]) {
    return trimmed;
  }

  const key = PACK_TYPE_SUFFIX_KEYS[match[2].toLowerCase() as keyof typeof PACK_TYPE_SUFFIX_KEYS];
  return key ? `${match[1]} ${labels[key]}` : trimmed;
}

function extractMeasurement(value: string) {
  const input = value.trim().replace(/\s+/g, " ");
  if (!input) {
    return "";
  }

  const exact = input.match(/\b\d+(?:\.\d+)?\s?(?:kg|g|gm|mg|ml|l|lt|ltr|litre|liter|oz|lb|pcs?|pc|pack)\b/i);
  if (exact?.[0]) {
    return exact[0].replace(/\s+/g, "").toUpperCase() === exact[0].replace(/\s+/g, "")
      ? exact[0]
      : exact[0].replace(/ml/i, "ml").replace(/l\b/i, "L");
  }

  const leading = input.match(/^\d+(?:\.\d+)?\s?\S+/);
  return leading?.[0] ?? "";
}
