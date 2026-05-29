import { apiFetch, ApiError } from "@/lib/api";
import { resolveApiBaseUrl } from "@/lib/api-base";
import { ensureSession } from "@/lib/auth-refresh";
import type { Product, ProductDraft, ProductImage, ProductStatus, VariantDraft } from "@/features/merchant-dashboard/types/dashboard";
import { isVisibleStockVariant, PRODUCT_DESCRIPTION_MAX_LENGTH } from "@/features/merchant-dashboard/lib/dashboard-utils";

export interface UploadRendition {
  kind: string;
  secureUrl: string;
  width: number;
  height: number;
  bytes: number | null;
  format: string;
}

export interface UploadedAsset {
  id: string;
  purpose: "PRODUCT_IMAGE";
  status: "READY";
  sourceSha256: string;
  originalFilename: string;
  mimeType: string;
  width: number;
  height: number;
  bytes: number;
  expiresAt: string;
  renditions: Record<string, UploadRendition>;
}

export interface UploadImageResponse {
  apiVersion: "v1";
  asset: UploadedAsset;
}

export interface UploadProgress {
  loaded: number;
  total: number;
  progress: number;
  speedBytesPerSecond: number;
}

export interface UploadCapabilities {
  apiVersion: "v1";
  provider: string;
  input: Record<string, boolean>;
  policies: Array<{
    purpose: "PRODUCT_IMAGE" | string;
    maxBytes: number;
    maxPixels: number;
    allowedMimeTypes: string[];
    minWidth?: number;
    minHeight?: number;
    aspectRatio?: { min: number; max: number };
    renditions: Array<{
      kind: string;
      format: "webp" | "jpeg" | string;
      maxDimension: number;
      quality: number;
      warmOnUpload?: boolean;
      transformation: string;
    }>;
  }>;
}

export type ProductPatchPayload = {
  storeId: string;
  expectedCatalogVersion: number;
  name?: string;
  sku?: string;
  category?: string;
  subCategory?: string;
  productType?: string;
  price?: number;
  compareAtPrice?: number;
  stock?: number;
  reorderPoint?: number;
  measurement?: ReturnType<typeof toMeasurementPayload>;
  status?: ProductStatus;
  seoTitle?: string;
  seoDescription?: string;
};

export function uploadProductImage(input: {
  file: File;
  storeId: string;
  draftId: string;
  clientFileId: string;
  idempotencyKey: string;
  signal?: AbortSignal;
  onProgress?: (progress: UploadProgress) => void;
}) {
  return sendProductImageUpload(input, true);
}

let capabilitiesPromise: Promise<UploadCapabilities> | null = null;

export function fetchUploadCapabilities(options: { force?: boolean } = {}) {
  if (!capabilitiesPromise || options.force) {
    capabilitiesPromise = apiFetch<UploadCapabilities>("/v1/uploads/capabilities");
  }
  return capabilitiesPromise;
}

export async function productImageUploadPolicy() {
  const capabilities = await fetchUploadCapabilities();
  return capabilities.policies.find((policy) => policy.purpose === "PRODUCT_IMAGE");
}

export async function createProductImageUploadIdempotencyKey(file: File, clientFileId: string) {
  markUploadPerformance("key_start");
  // ✅ PERF FIX: Use file metadata only, not full file content SHA-256.
  // The original sha256File() read the entire file into memory (file.arrayBuffer())
  // which blocks for 50–200ms on large files before XHR even opens.
  // File metadata (size + lastModified + name) is stable per-file and sufficient
  // for deduplication combined with the server-side sourceSha256 check.
  const scopedHash = await sha256Text(`${clientFileId}:${file.size}:${file.lastModified}:${file.name}`);
  markUploadPerformance("key_ready");
  measureUploadPerformance("key_duration", "key_start", "key_ready");
  return `upload:v1:${clientFileId}:${scopedHash}`;
}

export function isRetryableUploadError(error: unknown) {
  if (!(error instanceof ApiError)) {
    return false;
  }
  if (retryableFlag(error.body)) {
    return true;
  }
  return error.status === 0 || error.status === 408 || error.status === 429 || error.status >= 500;
}

export function uploadRetryDelayMs(error: unknown, attempt: number) {
  const retryAfterSeconds = retryAfterSecondsValue(error instanceof ApiError ? error.body : undefined);
  if (retryAfterSeconds !== undefined) {
    return Math.min(15_000, Math.max(250, retryAfterSeconds * 1000));
  }
  const exponent = Math.max(0, attempt - 1);
  const base = Math.min(8_000, 750 * (2 ** exponent));
  return Math.round(base + Math.random() * 250);
}

function sendProductImageUpload(input: {
  file: File;
  storeId: string;
  draftId: string;
  clientFileId: string;
  idempotencyKey: string;
  signal?: AbortSignal;
  onProgress?: (progress: UploadProgress) => void;
}, allowAuthRefresh: boolean): Promise<UploadImageResponse> {
  return new Promise<UploadImageResponse>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const started = performance.now();
    markUploadPerformance("xhr_start");
    xhr.open("POST", `${resolveApiBaseUrl()}/v1/uploads/images`);
    xhr.withCredentials = true;
    const csrf = csrfToken();
    if (csrf) {
      xhr.setRequestHeader("x-csrf-token", csrf);
    }

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) {
        return;
      }
      const elapsedSeconds = Math.max(0.1, (performance.now() - started) / 1000);
      input.onProgress?.({
        loaded: event.loaded,
        total: event.total,
        progress: Math.round((event.loaded / event.total) * 100),
        speedBytesPerSecond: event.loaded / elapsedSeconds
      });
    };

    xhr.onload = () => {
      markUploadPerformance("response");
      measureUploadPerformance("xhr_duration", "xhr_start", "response");
      logUploadTiming(xhr.getResponseHeader("Server-Timing"));
      const body = parseBody(xhr.responseText);
      if (xhr.status < 200 || xhr.status >= 300) {
        const error = new ApiError(errorMessage(body) ?? "Image upload failed.", xhr.status, body);
        if (xhr.status === 401 && allowAuthRefresh && shouldRefreshForAuthCode(body)) {
          ensureSession({
            forceRefresh: true,
            signal: input.signal,
            reason: "upload_401"
          })
            .then((session) => {
              if (session.status !== "authenticated") {
                reject(error);
                return;
              }
              sendProductImageUpload(input, false).then(resolve, reject);
            })
            .catch(reject);
          return;
        }
        reject(error);
        return;
      }
      resolve(body as UploadImageResponse);
    };
    xhr.onerror = () => reject(new ApiError("Connection error. Please check your internet and try again.", 0));
    xhr.ontimeout = () => reject(new ApiError("Image upload timed out.", 0));
    xhr.onabort = () => reject(new DOMException("Upload aborted.", "AbortError"));
    xhr.timeout = 30_000;

    input.signal?.addEventListener("abort", () => xhr.abort(), { once: true });

    const form = new FormData();
    form.append("file", input.file);
    form.append("purpose", "PRODUCT_IMAGE");
    form.append("storeId", input.storeId);
    form.append("draftId", input.draftId);
    form.append("clientFileId", input.clientFileId);
    form.append("idempotencyKey", input.idempotencyKey);
    form.append("declaredMimeType", input.file.type);
    xhr.send(form);
  });
}

export function fetchMerchantProducts(storeId: string, options: { signal?: AbortSignal } = {}) {
  return apiFetch<{ apiVersion: "v1"; products: Product[] }>(`/v1/merchant/products?storeId=${encodeURIComponent(storeId)}`, {
    signal: options.signal
  });
}

export function createMerchantProduct(draft: ProductDraft, storeId: string, publish: boolean) {
  return apiFetch<{ apiVersion: "v1"; product: Product }>("/v1/merchant/products", {
    method: "POST",
    headers: { "x-store-id": storeId },
    body: JSON.stringify(toProductPayload(draft, storeId, publish ? "Published" : "Draft"))
  });
}

export function updateMerchantProduct(productId: string, draft: ProductDraft, storeId: string, original?: Product) {
  const patch = original ? buildProductPatch(original, draft, storeId) : null;
  return apiFetch<{ apiVersion: "v1"; product: Partial<Product> & Pick<Product, "id"> }>(`/v1/merchant/products/${encodeURIComponent(productId)}`, {
    method: "PATCH",
    headers: { "x-store-id": storeId },
    body: JSON.stringify(patch ?? toProductPayload(draft, storeId, draft.status))
  });
}

export function buildProductPatch(original: Product, draft: ProductDraft, storeId: string): ProductPatchPayload | null {
  if (!Number.isInteger(original.catalogVersion) || original.catalogVersion < 1) {
    return null;
  }
  if (imagesChanged(original.images, draft.images) || visibleVariantsChanged(original.variants ?? [], draft.variants)) {
    return null;
  }

  const patch: ProductPatchPayload = {
    storeId,
    expectedCatalogVersion: original.catalogVersion
  };
  addTextPatch(patch, "name", original.name, draft.name);
  addTextPatch(patch, "sku", original.sku, draft.sku);
  addTextPatch(patch, "category", original.category, draft.category);
  addTextPatch(patch, "subCategory", original.subCategory, draft.subCategory);
  addTextPatch(patch, "productType", original.productType, draft.productType);
  addNumberPatch(patch, "price", original.price, draft.price);
  addNumberPatch(patch, "compareAtPrice", original.compareAtPrice ?? 0, draft.compareAtPrice);
  addNumberPatch(patch, "stock", original.stock, draft.stock);
  addNumberPatch(patch, "reorderPoint", original.reorderPoint, draft.reorderPoint);
  if (!sameMeasurement(original.measurement, draft.measurement)) {
    patch.measurement = toMeasurementPayload(draft.measurement);
  }
  if (original.status !== draft.status) {
    patch.status = draft.status;
  }
  addTextPatch(patch, "seoTitle", original.seoTitle ?? "", draft.seoTitle);
  addTextPatch(patch, "seoDescription", original.seoDescription ?? "", draft.seoDescription.slice(0, PRODUCT_DESCRIPTION_MAX_LENGTH));
  return patch;
}

function toProductPayload(draft: ProductDraft, storeId: string, status: ProductStatus) {
  const uploadedImages = draft.images.filter((image) => image.uploadAssetId);
  const visibleVariants = draft.variants.filter((variant, index) => isVisibleStockVariant(variant, draft, index));
  const payloadVariants = [toBaseVariantPayload(draft), ...visibleVariants.map((variant) => toVariantPayload(variant, draft))];
  const stock = payloadVariants.reduce((total, variant) => total + variant.stock, 0);
  const useProductImagesForEveryVariant = draft.sameImageAsProduct;
  return {
    storeId,
    name: draft.name,
    sku: draft.sku.trim() || undefined,
    category: draft.category,
    subCategory: draft.subCategory,
    productType: draft.productType,
    price: draft.price,
    compareAtPrice: draft.compareAtPrice || undefined,
    stock,
    reorderPoint: draft.reorderPoint,
    measurement: toMeasurementPayload(draft.measurement),
    status,
    seoTitle: draft.seoTitle,
    seoDescription: draft.seoDescription.slice(0, PRODUCT_DESCRIPTION_MAX_LENGTH),
    images: uploadedImages.map((image, index) => {
      const useVariantAssignments = !useProductImagesForEveryVariant && image.imageScope === "VARIANT";
      return {
        uploadAssetId: image.uploadAssetId,
        sortOrder: index,
        isPrimary: image.isPrimary ?? index === 0,
        altText: image.altText ?? image.name,
        imageScope: useVariantAssignments ? "VARIANT" : "PRODUCT",
        variantClientIds: useVariantAssignments ? (image.variantIds ?? []) : [],
        variantSkuIds: useVariantAssignments ? (image.variantSkuIds ?? []) : []
      };
    }),
    variants: payloadVariants
  };
}

function toBaseVariantPayload(draft: ProductDraft) {
  return {
    clientId: "base-product",
    name: draft.name.trim() || "Default",
    sku: draft.sku.trim() || undefined,
    price: draft.price,
    mrp: draft.compareAtPrice || undefined,
    costPrice: draft.costPrice || undefined,
    stock: draft.stock,
    measurement: toMeasurementPayload(draft.measurement)
  };
}

function toVariantPayload(variant: VariantDraft, draft: ProductDraft) {
  const variantSku = variant.sku.trim().toUpperCase();
  const productSku = draft.sku.trim().toUpperCase();
  return {
    clientId: variant.id,
    name: variant.name || draft.name || "Default",
    sku: variantSku && variantSku !== productSku ? variantSku : undefined,
    price: variant.price || draft.price,
    mrp: variant.mrp || draft.compareAtPrice || undefined,
    costPrice: variant.costPrice || undefined,
    stock: variant.stock,
    stockVersion: variant.stockVersion,
    measurement: toMeasurementPayload(variant.measurement)
  };
}

function toMeasurementPayload(measurement: ProductDraft["measurement"]) {
  return {
    unitGroup: measurement.unitGroup,
    quantityValue: measurement.quantityValue,
    quantityUnit: measurement.quantityUnit,
    packType: measurement.packType
  };
}

function addTextPatch<T extends keyof ProductPatchPayload>(
  patch: ProductPatchPayload,
  key: T,
  original: string,
  next: string
) {
  if (original.trim() !== next.trim()) {
    (patch[key] as ProductPatchPayload[T]) = next.trim() as ProductPatchPayload[T];
  }
}

function addNumberPatch<T extends keyof ProductPatchPayload>(
  patch: ProductPatchPayload,
  key: T,
  original: number,
  next: number
) {
  if (Math.abs(original - next) >= 0.0001) {
    (patch[key] as ProductPatchPayload[T]) = next as ProductPatchPayload[T];
  }
}

function sameMeasurement(left: Product["measurement"] | undefined, right: ProductDraft["measurement"]) {
  return Boolean(left) &&
    left?.unitGroup === right.unitGroup &&
    left.quantityValue === right.quantityValue &&
    left.quantityUnit === right.quantityUnit &&
    left.packType === right.packType;
}

function imagesChanged(original: Product["images"], next: ProductDraft["images"]) {
  const originalPersisted = original
    .slice()
    .sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0))
    .map(imageFingerprint);
  const nextPersisted = next
    .filter((image) => image.uploadAssetId)
    .slice()
    .sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0))
    .map(imageFingerprint);
  return JSON.stringify(originalPersisted) !== JSON.stringify(nextPersisted);
}

function imageFingerprint(image: ProductImage) {
  return {
    uploadAssetId: image.uploadAssetId ?? "",
    isPrimary: image.isPrimary ?? false,
    altText: image.altText ?? "",
    imageScope: image.imageScope ?? "PRODUCT",
    variantIds: [...(image.variantIds ?? [])].sort(),
    variantSkuIds: [...(image.variantSkuIds ?? [])].sort()
  };
}

function visibleVariantsChanged(original: VariantDraft[], next: VariantDraft[]) {
  const originalVisible = original
    .filter((variant) => !variant.isDefault)
    .map(variantFingerprint)
    .sort((left, right) => left.id.localeCompare(right.id));
  const nextVisible = next
    .map(variantFingerprint)
    .sort((left, right) => left.id.localeCompare(right.id));
  return JSON.stringify(originalVisible) !== JSON.stringify(nextVisible);
}

function variantFingerprint(variant: VariantDraft) {
  return {
    id: variant.id,
    name: variant.name.trim(),
    sku: variant.sku.trim().toUpperCase(),
    price: variant.price,
    mrp: variant.mrp ?? 0,
    costPrice: variant.costPrice ?? 0,
    stock: variant.stock,
    measurement: toMeasurementPayload(variant.measurement)
  };
}

function csrfToken() {
  return cookieValue("namastore_csrf") ?? cookieValue("__Host-csrf");
}

function cookieValue(name: string) {
  if (typeof document === "undefined") {
    return undefined;
  }
  return document.cookie
    .split("; ")
    .find((item) => item.startsWith(`${name}=`))
    ?.split("=")[1];
}

function parseBody(text: string) {
  if (!text) {
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function errorMessage(body: unknown) {
  if (body && typeof body === "object" && "message" in body) {
    return String((body as { message?: unknown }).message);
  }
  return undefined;
}

function shouldRefreshForAuthCode(body: unknown) {
  const code = errorCode(body);
  return (
    code === "AUTH_ACCESS_MISSING" ||
    code === "AUTH_ACCESS_INVALID" ||
    code === "UNAUTHORIZED"
  );
}

function errorCode(body: unknown) {
  if (body && typeof body === "object" && "code" in body) {
    const code = (body as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

function retryableFlag(body: unknown) {
  return Boolean(body && typeof body === "object" && (body as { retryable?: unknown }).retryable === true);
}

function retryAfterSecondsValue(body: unknown): number | undefined {
  if (!body || typeof body !== "object") {
    return undefined;
  }
  const direct = (body as { retryAfterSeconds?: unknown }).retryAfterSeconds;
  if (typeof direct === "number" && Number.isFinite(direct)) {
    return direct;
  }
  const details = (body as { details?: unknown }).details;
  if (details && typeof details === "object") {
    const nested = (details as { retryAfterSeconds?: unknown }).retryAfterSeconds;
    if (typeof nested === "number" && Number.isFinite(nested)) {
      return nested;
    }
  }
  return undefined;
}


async function sha256Text(value: string) {
  return digestHex(new TextEncoder().encode(value));
}

async function digestHex(value: ArrayBuffer | Uint8Array) {
  let source: ArrayBuffer;
  if (value instanceof Uint8Array) {
    const copy = new Uint8Array(value.byteLength);
    copy.set(value);
    source = copy.buffer;
  } else {
    source = value;
  }
  const digest = await crypto.subtle.digest("SHA-256", source);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function markUploadPerformance(name: string) {
  if (typeof performance !== "undefined" && "mark" in performance) {
    performance.mark(`upload:${name}`);
  }
}

function measureUploadPerformance(name: string, start: string, end: string) {
  if (typeof performance === "undefined" || !("measure" in performance)) {
    return;
  }
  try {
    performance.measure(`upload:${name}`, `upload:${start}`, `upload:${end}`);
  } catch {
    // Missing performance marks should never affect uploads.
  }
}

function logUploadTiming(serverTiming: string | null) {
  if (process.env.NODE_ENV === "production" || !serverTiming) {
    return;
  }
  const measures = typeof performance !== "undefined" && "getEntriesByType" in performance
    ? performance
        .getEntriesByType("measure")
        .filter((entry) => entry.name.startsWith("upload:"))
        .slice(-4)
        .map((entry) => ({ name: entry.name, durationMs: Math.round(entry.duration) }))
    : [];
  console.debug("upload.timing", { serverTiming, measures });
}

export function productImageFromAsset(
  asset: UploadedAsset,
  local: Pick<ProductImage, "id" | "name" | "url"> & Partial<Pick<ProductImage, "imageScope">>
): ProductImage {
  const card = asset.renditions.card ?? asset.renditions.detail ?? Object.values(asset.renditions)[0];
  return {
    ...local,
    imageScope: local.imageScope ?? "PRODUCT",
    uploadAssetId: asset.id,
    name: asset.originalFilename,
    url: card?.secureUrl ?? local.url,
    focus: "Center",
    isPrimary: false
  };
}
