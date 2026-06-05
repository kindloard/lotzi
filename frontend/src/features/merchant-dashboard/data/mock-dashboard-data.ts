import type {
  MerchantChrome,
  Product,
  ProductDraft,
  ProductStatus
} from "../types/dashboard";
import { defaultMeasurementForProduct, normalizeMeasurement } from "./product-measurement";
import { defaultSubcategoryForCategory, defaultTypeForSubcategory } from "./subcategories";

export const initialProducts: Product[] = [
  product("p-1", "Heritage Filter Coffee", "COF-250", "Beverages", 349, 84, 24, "Published", 418, 145882, 7.8, "Coffee", "Filter Coffee"),
  product("p-2", "Cold Pressed Groundnut Oil", "OIL-1L", "Grocery", 279, 18, 28, "Published", 296, 82584, 5.9, "Cooking Oils", "Groundnut Oil"),
  product("p-3", "Millet Breakfast Mix", "MLT-500", "Grocery", 199, 12, 20, "Needs review", 184, 36616, 4.6, "Staples", "Rava"),
  product("p-4", "Artisan Jaggery Blocks", "JAG-750", "Grocery", 159, 65, 18, "Published", 162, 25758, 3.9, "Staples", "Sugar"),
  product("p-5", "Premium Cashew Pack", "CSH-250", "Grocery", 449, 9, 16, "Published", 133, 59717, 6.4, "Dry Fruits & Nuts", "Cashews"),
  product("p-6", "Organic Turmeric Powder", "TRM-200", "Grocery", 129, 46, 14, "Draft", 0, 0, 0, "Spices & Masala", "Turmeric"),
  product("p-7", "Stone Ground Wheat Flour", "WHT-5K", "Grocery", 385, 28, 22, "Published", 95, 36575, 4.2, "Staples", "Wheat"),
  product("p-8", "Festival Gift Hamper", "GFT-01", "Snacks", 1199, 6, 10, "Paused", 41, 49159, 8.1, "Namkeen", "Mixture")
];

export const defaultDraft: ProductDraft = {
  createIdempotencyKey: "",
  name: "",
  sku: "",
  category: "Grocery",
  subCategory: defaultSubcategoryForCategory("Grocery"),
  productType: defaultTypeForSubcategory("Grocery", defaultSubcategoryForCategory("Grocery")),
  price: 0,
  compareAtPrice: 0,
  costPrice: 0,
  stock: 0,
  reorderPoint: 10,
  measurement: defaultMeasurementForProduct({
    category: "Grocery",
    subCategory: defaultSubcategoryForCategory("Grocery"),
    productType: defaultTypeForSubcategory("Grocery", defaultSubcategoryForCategory("Grocery"))
  }),
  status: "Draft",
  description: "",
  seoTitle: "",
  seoDescription: "",
  weight: "",
  shippingClass: "Standard",
  mediaScope: "PRODUCT",
  sameImageAsProduct: true,
  images: [],
  variants: [{
    id: "v-1",
    persistedId: null,
    _persisted: false,
    name: "",
    sku: "",
    price: 0,
    mrp: 0,
    costPrice: 0,
    stock: 0,
    measurement: defaultMeasurementForProduct({
      category: "Grocery",
      subCategory: defaultSubcategoryForCategory("Grocery"),
      productType: defaultTypeForSubcategory("Grocery", defaultSubcategoryForCategory("Grocery"))
    })
  }]
};

export const fallbackMerchantChrome: MerchantChrome = {
  storeId: "",
  userName: "",
  userEmail: "",
  storeName: "",
  storeLogoUrl: null,
  roleName: ""
};

function product(
  id: string,
  name: string,
  sku: string,
  category: string,
  price: number,
  stock: number,
  reorderPoint: number,
  status: ProductStatus,
  sales: number,
  revenue: number,
  conversion: number,
  subCategory: string = defaultSubcategoryForCategory(category),
  productType: string = defaultTypeForSubcategory(category, subCategory)
): Product {
  const measurement = normalizeMeasurement(defaultMeasurementForProduct({ category, subCategory, productType }), price);
  return {
    id,
    name,
    sku,
    category,
    subCategory,
    productType,
    price,
    compareAtPrice: 0,
    costPrice: 0,
    stock,
    reorderPoint,
    measurement,
    unitDisplay: measurement.unitDisplay,
    pricePerBaseUnit: measurement.pricePerBaseUnit,
    pricePerBaseUnitDisplay: measurement.pricePerBaseUnitDisplay,
    status,
    description: "",
    sales,
    revenue,
    conversion,
    images: [],
    updatedAt: new Date(Date.now() - Math.floor(Math.random() * 6) * 86400000).toISOString(),
    catalogVersion: 1,
    variants: [{
      id: `${id}-default`,
      persistedId: `${id}-default`,
      _persisted: true,
      name: `${name} ${measurement.unitDisplay}`,
      sku,
      price,
      mrp: 0,
      costPrice: 0,
      stock,
      isDefault: true,
      position: 0,
      measurement,
      unitDisplay: measurement.unitDisplay,
      pricePerBaseUnit: measurement.pricePerBaseUnit,
      pricePerBaseUnitDisplay: measurement.pricePerBaseUnitDisplay
    }]
  };
}


