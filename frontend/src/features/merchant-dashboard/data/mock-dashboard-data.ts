import type {
  MerchantChrome,
  Order,
  OrderStatus,
  PaymentStatus,
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

export const initialOrders: Order[] = [
  order("NS-10482", "Aarav Mehta", "aarav@example.com", 2487, 6, "New", "Paid", "Storefront", "Chennai", "2026-05-23T10:40:00.000Z"),
  order("NS-10481", "Nisha Rao", "nisha@example.com", 1199, 1, "Processing", "Paid", "Mobile", "Bengaluru", "2026-05-23T09:54:00.000Z"),
  order("NS-10480", "Ishaan Pillai", "ishaan@example.com", 642, 3, "Packed", "Authorized", "Storefront", "Kochi", "2026-05-23T08:18:00.000Z"),
  order("NS-10479", "Maya Krishnan", "maya@example.com", 558, 2, "Refund review", "Paid", "Instagram", "Coimbatore", "2026-05-22T18:42:00.000Z"),
  order("NS-10478", "Rohan Iyer", "rohan@example.com", 349, 1, "Shipped", "Paid", "Storefront", "Hyderabad", "2026-05-22T15:05:00.000Z"),
  order("NS-10477", "Diya Shah", "diya@example.com", 1845, 4, "Delivered", "Paid", "Mobile", "Mumbai", "2026-05-22T12:34:00.000Z"),
  order("NS-10476", "Vikram S", "vikram@example.com", 734, 2, "Processing", "Paid", "Storefront", "Pune", "2026-05-22T11:04:00.000Z"),
  order("NS-10475", "Anika Das", "anika@example.com", 3297, 7, "New", "Authorized", "Storefront", "Kolkata", "2026-05-22T09:14:00.000Z"),
  order("NS-10474", "Kabir Khan", "kabir@example.com", 998, 3, "Packed", "Paid", "Mobile", "Delhi", "2026-05-21T20:09:00.000Z"),
  order("NS-10473", "Sana Ahmed", "sana@example.com", 129, 1, "Delivered", "Paid", "Storefront", "Lucknow", "2026-05-21T16:12:00.000Z"),
  order("NS-10472", "Pranav Nair", "pranav@example.com", 2294, 5, "Shipped", "Paid", "Storefront", "Kochi", "2026-05-21T13:28:00.000Z"),
  order("NS-10471", "Meera Jain", "meera@example.com", 728, 2, "Delivered", "Paid", "Mobile", "Jaipur", "2026-05-21T10:31:00.000Z")
];

export const defaultDraft: ProductDraft = {
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
  seoTitle: "",
  seoDescription: "",
  weight: "",
  shippingClass: "Standard",
  mediaScope: "PRODUCT",
  sameImageAsProduct: true,
  images: [],
  variants: [{
    id: "v-1",
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
    sales,
    revenue,
    conversion,
    images: [],
    updatedAt: new Date(Date.now() - Math.floor(Math.random() * 6) * 86400000).toISOString(),
    catalogVersion: 1,
    variants: [{
      id: `${id}-default`,
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

function order(
  id: string,
  customer: string,
  email: string,
  total: number,
  items: number,
  status: OrderStatus,
  payment: PaymentStatus,
  channel: string,
  city: string,
  placedAt: string
): Order {
  return {
    id,
    customer,
    email,
    total,
    items,
    status,
    payment,
    channel,
    city,
    placedAt,
    timeline: [
      { label: "Order created", at: placedAt },
      { label: payment === "Paid" ? "Payment captured" : "Payment authorized", at: placedAt },
      { label: status, at: new Date(Date.parse(placedAt) + 1800000).toISOString() }
    ]
  };
}

