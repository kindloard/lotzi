import { defaultDraft } from "../data/mock-dashboard-data";
import {
  coerceMeasurementForProduct,
  defaultMeasurementForProduct,
  normalizeMeasurement
} from "../data/product-measurement";
import {
  defaultSubcategoryForCategory,
  defaultTypeForSubcategory,
  typesForSubcategory
} from "../data/subcategories";
import type { Product, ProductDraft, ProductImage, ProductMeasurement, VariantDraft } from "../types/dashboard";
import { PRODUCT_DESCRIPTION_MAX_LENGTH } from "./dashboard-utils";

export function productToDraft(product: Product): ProductDraft {
  const category = product.category || defaultDraft.category;
  const subCategory = product.subCategory || defaultSubcategoryForCategory(category);
  const productType = typesForSubcategory(category, subCategory).includes(product.productType)
    ? product.productType
    : defaultTypeForSubcategory(category, subCategory);
  const context = { category, subCategory, productType };
  const measurement = coerceMeasurementForProduct(
    product.measurement ?? defaultMeasurementForProduct(context),
    context
  );
  const variants = productVariantsToDraft(product, measurement);
  const baseVariant = findBaseVariant(product, variants, measurement) ?? productVariantFromProduct(product, measurement);
  const draftVariants = variants
    .filter((variant) => variant.id !== baseVariant.id)
    .map((variant) => normalizeVariantFlags(variant, product, measurement, true));
  const normalizedBaseVariant = normalizeVariantFlags(
    {
      ...baseVariant,
      stock: baseVariant._persisted
        ? baseVariant.stock
        : Math.max(product.stock - draftVariants.reduce((total, variant) => total + variant.stock, 0), 0)
    },
    product,
    measurement,
    false
  );
  const images = product.images
    .slice()
    .sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0))
    .map((image, index) => productImageToDraft(image, index));
  const hasVariantImages = images.some((image) => image.imageScope === "VARIANT");

  return {
    ...defaultDraft,
    name: product.name,
    sku: product.sku,
    category,
    subCategory,
    productType,
    price: product.price,
    compareAtPrice: product.compareAtPrice ?? 0,
    costPrice: product.costPrice ?? normalizedBaseVariant.costPrice ?? 0,
    stock: normalizedBaseVariant.stock,
    reorderPoint: product.reorderPoint,
    measurement,
    status: product.status,
    description: product.description ?? "",
    seoTitle: product.seoTitle ?? "",
    seoDescription: (product.seoDescription ?? "").slice(0, PRODUCT_DESCRIPTION_MAX_LENGTH),
    mediaScope: hasVariantImages ? "VARIANT" : "PRODUCT",
    sameImageAsProduct: !hasVariantImages,
    images,
    variants: draftVariants,
    baseVariant: normalizedBaseVariant,
    catalogVersion: product.catalogVersion
  };
}

function productVariantsToDraft(product: Product, productMeasurement: ProductMeasurement): VariantDraft[] {
  if (!product.variants?.length) {
    return [productVariantFromProduct(product, productMeasurement)];
  }

  return product.variants.map((variant) => {
    const measurement = variant.measurement ?? productMeasurement;
    const normalized = normalizeMeasurement(measurement, variant.price || product.price);
    return {
      id: variant.id,
      persistedId: variant.id,
      _persisted: true,
      name: variant.name || product.name,
      sku: variant.sku || product.sku,
      price: variant.price || product.price,
      mrp: variant.mrp ?? product.compareAtPrice ?? 0,
      costPrice: variant.costPrice ?? product.costPrice ?? 0,
      stock: variant.stock,
      stockOnHand: variant.stockOnHand,
      stockReserved: variant.stockReserved,
      stockVersion: variant.stockVersion,
      isDefault: variant.isDefault,
      position: variant.position,
      measurement,
      unitDisplay: normalized.unitDisplay,
      pricePerBaseUnit: normalized.pricePerBaseUnit,
      pricePerBaseUnitDisplay: normalized.pricePerBaseUnitDisplay
    };
  });
}

function productVariantFromProduct(product: Product, productMeasurement: ProductMeasurement): VariantDraft {
  const normalized = normalizeMeasurement(productMeasurement, product.price);
  return {
    id: `${product.id}-base`,
    persistedId: null,
    _persisted: false,
    name: product.name || "Default",
    sku: product.sku,
    price: product.price,
    mrp: product.compareAtPrice ?? 0,
    costPrice: product.costPrice ?? 0,
    stock: product.stock,
    stockOnHand: product.stockOnHand,
    stockReserved: product.stockReserved,
    stockVersion: 1,
    isDefault: true,
    position: 0,
    measurement: productMeasurement,
    unitDisplay: normalized.unitDisplay,
    pricePerBaseUnit: normalized.pricePerBaseUnit,
    pricePerBaseUnitDisplay: normalized.pricePerBaseUnitDisplay
  };
}

function findBaseVariant(
  product: Product,
  variants: VariantDraft[],
  productMeasurement: ProductMeasurement
) {
  const defaultVariant = variants.find((variant) => variant.isDefault && isProductBackedVariant(product, variant, productMeasurement));
  if (defaultVariant) {
    return defaultVariant;
  }
  return variants.find((variant) => isProductBackedVariant(product, variant, productMeasurement)) ?? null;
}

function isProductBackedVariant(product: Product, variant: VariantDraft, productMeasurement: ProductMeasurement) {
  const variantName = variant.name.trim().toLowerCase();
  const productName = product.name.trim().toLowerCase();
  const nameMatches = variantName === "default" || variantName === productName;
  const skuMatches = variant.sku.trim().toUpperCase() === product.sku.trim().toUpperCase();
  const priceMatches = numbersEqual(variant.price, product.price);
  const mrpMatches = numbersEqual(variant.mrp ?? 0, product.compareAtPrice ?? 0);
  return nameMatches && skuMatches && priceMatches && mrpMatches && sameMeasurement(variant.measurement, productMeasurement);
}

function sameMeasurement(left: ProductMeasurement, right: ProductMeasurement) {
  return (
    left.unitGroup === right.unitGroup &&
    left.quantityValue === right.quantityValue &&
    left.quantityUnit === right.quantityUnit &&
    left.packType === right.packType
  );
}

function numbersEqual(left: number, right: number) {
  return Math.abs(left - right) < 0.0001;
}

function normalizeVariantFlags(
  variant: VariantDraft,
  product: Product,
  productMeasurement: ProductMeasurement,
  visibleVariant: boolean
): VariantDraft {
  return {
    ...variant,
    manualPrice: visibleVariant && variant.price !== product.price,
    manualPackSize: visibleVariant && variant.measurement.quantityValue !== productMeasurement.quantityValue,
    manualUnit: visibleVariant && variant.measurement.quantityUnit !== productMeasurement.quantityUnit,
    manualPackType: visibleVariant && variant.measurement.packType !== productMeasurement.packType
  };
}

function productImageToDraft(image: ProductImage, index: number): ProductImage {
  const hasVariantAssignment = Boolean(image.variantIds?.length || image.variantSkuIds?.length);
  return {
    ...image,
    imageScope: hasVariantAssignment ? "VARIANT" : "PRODUCT",
    sortOrder: index,
    isPrimary: image.isPrimary ?? index === 0,
    variantIds: image.variantIds ?? [],
    variantSkuIds: image.variantSkuIds ?? [],
    upload: undefined
  };
}
