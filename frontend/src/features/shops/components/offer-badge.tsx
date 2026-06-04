
type OfferBadgeProps = {
  className?: string;
  compareAtPrice: number | null | undefined;
  price: number | null | undefined;
  size?: "sm" | "md";
};

export function getOfferDiscountPercent(
  price: number | null | undefined,
  compareAtPrice: number | null | undefined
) {
  if (
    typeof price !== "number" ||
    typeof compareAtPrice !== "number" ||
    !Number.isFinite(price) ||
    !Number.isFinite(compareAtPrice) ||
    price < 0 ||
    compareAtPrice <= 0 ||
    compareAtPrice <= price
  ) {
    return null;
  }

  return Math.min(100, Math.max(1, Math.round(((compareAtPrice - price) / compareAtPrice) * 100)));
}

export function OfferBadge({
  className = "",
  compareAtPrice,
  price,
  size = "sm"
}: OfferBadgeProps) {
  const percent = getOfferDiscountPercent(price, compareAtPrice);

  if (!percent) {
    return null;
  }

  const sizeClass = size === "md"
    ? "px-3 py-1.5 text-xs"
    : "px-2.5 py-1 text-[10px]";

  return (
    <span
      aria-label={`${percent}% off`}
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-brand text-black font-extrabold uppercase tracking-wide shadow-sm ring-1 ring-black/10 ${sizeClass} ${className}`}
    >
      {percent}% OFF
    </span>
  );
}
