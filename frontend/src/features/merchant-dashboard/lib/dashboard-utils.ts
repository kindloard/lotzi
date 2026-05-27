import type { Dispatch, SetStateAction } from "react";
import type { MerchantDashboardBootstrap } from "@/lib/merchant-dashboard-api";
import type { MerchantChrome, ProductDraft, VariantDraft } from "../types/dashboard";
import { isMeasurementAllowed } from "../data/product-measurement";

export const PRODUCT_DESCRIPTION_MAX_LENGTH = 250;

export type ProductDraftValidationKey =
  | "nameRequired"
  | "priceRequired"
  | "compareAtPriceAbovePrice"
  | "variantNameRequired"
  | "variantPriceRequired"
  | "variantMrpInvalid"
  | "variantStockInvalid"
  | "measurementInvalid"
  | "variantMeasurementInvalid"
  | "duplicateVariantSku"
  | "stockRequired"
  | "imageRequired"
  | "pendingUploads";

export function validateDraftStep(draft: ProductDraft, step: number) {
  const uploadedImages = draft.images.filter((image) => image.uploadAssetId);
  const pendingImages = draft.images.filter((image) => image.upload && image.upload.status !== "uploaded");
  if (step === 0) {
    if (!draft.name.trim()) {
      return ["nameRequired"] satisfies ProductDraftValidationKey[];
    }
  }
  if (step === 1) {
    const pricingErrors: ProductDraftValidationKey[] = [];
    if (draft.price <= 0) {
      pricingErrors.push("priceRequired");
    }
    if (draft.compareAtPrice > 0 && draft.price > 0 && draft.compareAtPrice <= draft.price) {
      pricingErrors.push("compareAtPriceAbovePrice");
    }
    if (!isMeasurementAllowed(draft.measurement, draft)) {
      pricingErrors.push("measurementInvalid");
    }
    if (draft.variants.some((variant) => !variant.name.trim())) {
      pricingErrors.push("variantNameRequired");
    }
    if (draft.variants.some((variant) => variant.price <= 0)) {
      pricingErrors.push("variantPriceRequired");
    }
    if (draft.variants.some((variant) => variant.mrp > 0 && variant.mrp < variant.price)) {
      pricingErrors.push("variantMrpInvalid");
    }
    if (draft.variants.some((variant) => !Number.isInteger(variant.stock) || variant.stock < 0)) {
      pricingErrors.push("variantStockInvalid");
    }
    if (draft.variants.some((variant) => !isMeasurementAllowed(variant.measurement, draft))) {
      pricingErrors.push("variantMeasurementInvalid");
    }
    if (hasDuplicateVariantSku(draft.variants, draft.sku)) {
      pricingErrors.push("duplicateVariantSku");
    }
    return pricingErrors;
  }
  if (step === 2 && Math.max(draft.stock, draft.variants.reduce((total, variant) => total + variant.stock, 0)) < 1) {
    return ["stockRequired"] satisfies ProductDraftValidationKey[];
  }
  if (step === 3 && uploadedImages.length === 0) {
    return ["imageRequired"] satisfies ProductDraftValidationKey[];
  }
  if (step === 3 && pendingImages.length > 0) {
    return ["pendingUploads"] satisfies ProductDraftValidationKey[];
  }
  return [];
}

export function toMerchantChrome(payload: MerchantDashboardBootstrap): MerchantChrome {
  const storeName = payload.store.name.trim() || payload.store.slug.trim() || "Store";
  return {
    storeId: payload.store.id,
    userName: payload.user.name || payload.user.email.split("@")[0],
    userEmail: payload.user.email,
    storeName,
    storeLogoUrl: payload.store.logoUrl,
    roleName: payload.membership.roleName || ""
  };
}

export function updateVariant(
  setDraft: Dispatch<SetStateAction<ProductDraft>>,
  variantId: string,
  patch: Partial<VariantDraft>
) {
  setDraft((current) => ({
    ...current,
    variants: current.variants.map((item) => item.id === variantId ? { ...item, ...patch } : item)
  }));
}

export function isVisibleStockVariant(
  variant: VariantDraft,
  draft: Pick<ProductDraft, "compareAtPrice" | "costPrice" | "measurement" | "name" | "price" | "sku" | "variants">,
  index: number
) {
  const productName = draft.name.trim();
  const variantName = variant.name.trim();
  const productSku = draft.sku.trim().toUpperCase();
  const variantSku = variant.sku.trim().toUpperCase();

  const differsFromProduct =
    variant.price !== draft.price ||
    (variant.mrp ?? 0) !== (draft.compareAtPrice ?? 0) ||
    (variant.costPrice ?? 0) !== (draft.costPrice ?? 0) ||
    (variantSku !== "" && variantSku !== productSku) ||
    !sameMeasurement(variant.measurement, draft.measurement) ||
    Boolean(variantName && variantName !== productName && variantName !== "Default" && variantName !== `Variant ${index + 1}`);

  return differsFromProduct || (draft.variants.length > 1 && index > 0);
}

function hasDuplicateVariantSku(variants: VariantDraft[], productSku = "") {
  const inheritedSku = productSku.trim().toUpperCase();
  const seen = new Set<string>();
  for (const variant of variants) {
    const sku = variant.sku.trim().toUpperCase();
    if (!sku) {
      continue;
    }
    if (sku === inheritedSku) {
      continue;
    }
    if (seen.has(sku)) {
      return true;
    }
    seen.add(sku);
  }
  return false;
}

function sameMeasurement(left: ProductDraft["measurement"], right: ProductDraft["measurement"]) {
  return (
    left.unitGroup === right.unitGroup &&
    left.quantityValue === right.quantityValue &&
    left.quantityUnit === right.quantityUnit &&
    left.packType === right.packType
  );
}

export function initials(value: string) {
  return value
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function uid() {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

