export type NavId =
  | "dashboard"
  | "products"
  | "orders"
  | "analytics"
  | "customers"
  | "inventory"
  | "payments"
  | "settings";

export type ProductStatus = "Published" | "Draft" | "Paused" | "Needs review";
export type OrderStatus = "New" | "Processing" | "Packed" | "Shipped" | "Delivered" | "Refund review" | "Failed" | "Cancelled";
export type PaymentStatus = "Paid" | "Authorized" | "Refunded" | "Failed";
export type UnitGroup = "WEIGHT" | "VOLUME" | "COUNT" | "LENGTH" | "AREA" | "BUNDLE";
export type MeasurementUnit =
  | "MG"
  | "G"
  | "KG"
  | "TONNE"
  | "ML"
  | "LITRE"
  | "GALLON"
  | "PIECE"
  | "PAIR"
  | "DOZEN"
  | "CM"
  | "METER"
  | "INCH"
  | "FEET"
  | "SQ_FT"
  | "SQ_METER";
export type PackType =
  | "UNIT"
  | "PACK"
  | "PACKET"
  | "BOX"
  | "CARTON"
  | "BOTTLE"
  | "POUCH"
  | "JAR"
  | "CAN"
  | "SACHET"
  | "STRIP"
  | "BAG"
  | "TRAY"
  | "BUNCH"
  | "BUNDLE"
  | "SET";

export interface ProductMeasurement {
  unitGroup: UnitGroup;
  quantityValue: number;
  quantityUnit: MeasurementUnit;
  normalizedValue?: number;
  normalizedUnit?: MeasurementUnit;
  packType: PackType;
  pricePerBaseUnit?: number;
}

export interface ProductImage {
  id: string;
  imageScope: "PRODUCT" | "VARIANT";
  uploadAssetId?: string;
  name: string;
  url: string;
  focus: "Center" | "Top" | "Bottom";
  sortOrder?: number;
  isPrimary?: boolean;
  altText?: string | null;
  variantIds?: string[];
  variantSkuIds?: string[];
  upload?: {
    attemptId: string;
    attempt: number;
    clientFileId: string;
    idempotencyKey: string;
    previewUrl: string;
    status: "queued" | "validating" | "uploading" | "processing" | "uploaded" | "failed" | "retrying" | "aborted";
    progress: number;
    speedBytesPerSecond: number;
    retryable?: boolean;
    error?: string;
    fileFingerprint?: {
      name: string;
      size: number;
      lastModified: number;
      type: string;
    };
  };
}

export interface VariantDraft {
  id: string;
  persistedId?: string | null;
  _persisted?: boolean;
  name: string;
  sku: string;
  price: number;
  mrp: number;
  costPrice: number;
  stock: number;
  manualPrice?: boolean;
  manualPackSize?: boolean;
  manualUnit?: boolean;
  manualPackType?: boolean;
  isDefault?: boolean;
  position?: number;
  stockOnHand?: number;
  stockReserved?: number;
  stockVersion?: number;
  measurement: ProductMeasurement;
  unitDisplay?: string;
  pricePerBaseUnit?: number;
  pricePerBaseUnitDisplay?: string;
}

export interface Product {
  id: string;
  name: string;
  sku: string;
  category: string;
  subCategory: string;
  productType: string;
  price: number;
  compareAtPrice?: number;
  costPrice?: number;
  stock: number;
  stockReserved?: number;
  stockOnHand?: number;
  reorderPoint: number;
  measurement?: ProductMeasurement;
  unitDisplay?: string;
  pricePerBaseUnit?: number;
  pricePerBaseUnitDisplay?: string;
  status: ProductStatus;
  description?: string | null;
  seoTitle?: string;
  seoDescription?: string;
  sales: number;
  revenue: number;
  conversion: number;
  images: ProductImage[];
  updatedAt: string;
  catalogVersion: number;
  variants?: VariantDraft[];
}

export interface Order {
  id: string;
  customer: string;
  email: string;
  total: number;
  items: number;
  lineItems: OrderLineItem[];
  status: OrderStatus;
  payment: PaymentStatus;
  channel: string;
  city: string;
  placedAt: string;
  timeline: Array<{ label: string; at: string }>;
}

export interface OrderLineItem {
  id: string;
  name: string;
  variantName: string | null;
  unitDisplay: string | null;
  quantity: number;
  unitPrice: number;
  total: number;
  imageUrl: string | null;
  sku: string | null;
}

export interface MerchantMetrics {
  revenue: number;
  orderCount: number;
  productCount: number;
  pendingOrders: number;
  inventoryAlerts: number;
  conversion: number;
}

export interface MerchantChrome {
  storeId: string;
  userName: string;
  userEmail: string;
  storeName: string;
  storeLogoUrl: string | null;
  roleName: string;
}

export type MerchantChromeStatus = "idle" | "loading" | "ready" | "error";

export interface ProductDraft {
  createIdempotencyKey?: string;
  name: string;
  sku: string;
  category: string;
  subCategory: string;
  productType: string;
  price: number;
  compareAtPrice: number;
  costPrice: number;
  stock: number;
  reorderPoint: number;
  measurement: ProductMeasurement;
  status: ProductStatus;
  description: string;
  seoTitle: string;
  seoDescription: string;
  weight: string;
  shippingClass: string;
  mediaScope: "PRODUCT" | "VARIANT";
  sameImageAsProduct: boolean;
  images: ProductImage[];
  variants: VariantDraft[];
  baseVariant?: VariantDraft;
  catalogVersion?: number;
}

