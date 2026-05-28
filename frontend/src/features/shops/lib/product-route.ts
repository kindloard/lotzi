const PRODUCT_PUBLIC_ID_PATTERN = /^[0-9a-f]{32}$/i;

export function productRefFromParts(productPublicId: string, productSlug: string) {
  const id = normalizeProductPublicId(productPublicId);
  const slug = normalizeProductSlug(productSlug);
  return slug ? `${id}-${slug}` : id;
}

export function canonicalProductPath(
  shopPublicId: string,
  shopPublicSlug: string,
  productPublicId: string,
  productSlug: string
) {
  return `/shop/${encodeURIComponent(shopPublicId)}/${encodeURIComponent(shopPublicSlug)}/product/${encodeURIComponent(productRefFromParts(productPublicId, productSlug))}`;
}

export function parseProductRefSegment(productRef: string) {
  const normalized = productRef.trim().toLowerCase();
  const match = normalized.match(/^([0-9a-f]{32})(?:-(.*))?$/);
  if (!match?.[1]) {
    return null;
  }
  return {
    productPublicId: match[1],
    productSlug: normalizeProductSlug(match[2] ?? "")
  };
}

export function normalizeProductPublicId(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!PRODUCT_PUBLIC_ID_PATTERN.test(normalized)) {
    return normalized.replace(/[^a-f0-9]/g, "").slice(0, 32);
  }
  return normalized;
}

export function normalizeProductSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}
