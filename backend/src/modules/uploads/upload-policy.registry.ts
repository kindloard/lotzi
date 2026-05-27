import { Injectable } from "@nestjs/common";
import {
  UploadPurpose,
  UploadRenditionKind
} from "@prisma/client";
import { PERMISSIONS, Permission } from "../rbac/permissions";

export interface UploadContext {
  storeId?: string;
  uploadAssetId: string;
}

export interface RenditionSpec {
  kind: UploadRenditionKind;
  format: "webp" | "jpeg";
  maxDimension: number;
  quality: number;
  warmOnUpload?: boolean;
}

export interface UploadValidationInput {
  width: number;
  height: number;
  bytes: number;
  mimeType: string;
  sourceSha256: string;
}

export interface ValidationIssue {
  code: string;
  message: string;
}

export interface UploadPolicy {
  purpose: UploadPurpose;
  scope: "STORE" | "USER" | "PLATFORM";
  requiredPermissions: Permission[];
  maxBytes: number;
  maxPixels: number;
  allowedMimeTypes: string[];
  allowedMagicTypes: string[];
  minWidth?: number;
  minHeight?: number;
  aspectRatio?: { min: number; max: number };
  duplicateScope: "STORE_DRAFT" | "STORE" | "USER";
  folder: (ctx: UploadContext) => string;
  renditions: RenditionSpec[];
  validate?: (input: UploadValidationInput) => Promise<ValidationIssue[]>;
}

const PRODUCT_IMAGE_POLICY: UploadPolicy = {
  purpose: UploadPurpose.PRODUCT_IMAGE,
  scope: "STORE",
  requiredPermissions: [PERMISSIONS.PRODUCT_MANAGE],
  maxBytes: 12 * 1024 * 1024,
  maxPixels: 40_000_000,
  allowedMimeTypes: [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/heif",
    "image/avif",
    "image/tiff",
    "image/gif"
  ],
  allowedMagicTypes: [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/heif",
    "image/avif",
    "image/tiff",
    "image/gif"
  ],
  duplicateScope: "STORE_DRAFT",
  folder: (ctx) => `stores/${ctx.storeId}/uploads/${ctx.uploadAssetId}`,
  renditions: [
    // Eager (warmOnUpload: true) = generated synchronously during upload, URL is immediately valid.
    // Lazy (warmOnUpload: false) = Cloudinary transformation URL, generated on first CDN request (~2-4s).
    { kind: UploadRenditionKind.THUMBNAIL,    format: "webp",  maxDimension: 160,  quality: 82, warmOnUpload: true  },
    { kind: UploadRenditionKind.CARD,         format: "webp",  maxDimension: 640,  quality: 84, warmOnUpload: true  },
    // ✅ FIX: DETAIL and JPEG_FALLBACK added to eager — needed immediately on product detail page.
    // Previously lazy, which caused "broken image URL" on first product page load after upload.
    { kind: UploadRenditionKind.DETAIL,       format: "webp",  maxDimension: 1200, quality: 86, warmOnUpload: true  },
    { kind: UploadRenditionKind.JPEG_FALLBACK, format: "jpeg", maxDimension: 1200, quality: 84, warmOnUpload: true  },
    // ✅ FIX: ZOOM removed from eager — was the primary upload bottleneck (2200px WebP = 3-8s).
    // ZOOM is only needed when user explicitly zooms; lazy CDN generation on first zoom is fine.
    { kind: UploadRenditionKind.ZOOM,         format: "webp",  maxDimension: 2200, quality: 88, warmOnUpload: false }
  ]
};

@Injectable()
export class UploadPolicyRegistry {
  private readonly policies = new Map<UploadPurpose, UploadPolicy>([
    [UploadPurpose.PRODUCT_IMAGE, PRODUCT_IMAGE_POLICY]
  ]);

  get(purpose: UploadPurpose): UploadPolicy {
    const policy = this.policies.get(purpose);
    if (!policy) {
      throw new Error(`Unsupported upload purpose: ${purpose}`);
    }
    return policy;
  }

  listCapabilities() {
    return Array.from(this.policies.values()).map((policy) => ({
      purpose: policy.purpose,
      maxBytes: policy.maxBytes,
      maxPixels: policy.maxPixels,
      allowedMimeTypes: policy.allowedMimeTypes,
      minWidth: policy.minWidth,
      minHeight: policy.minHeight,
      aspectRatio: policy.aspectRatio,
      renditions: policy.renditions.map((rendition) => ({
        ...rendition,
        transformation: renditionTransformation(rendition)
      }))
    }));
  }
}

export function renditionTransformation(spec: RenditionSpec): string {
  const format = spec.format === "jpeg" ? "jpg" : spec.format;
  return `c_limit,w_${spec.maxDimension},h_${spec.maxDimension},f_${format},q_${spec.quality}`;
}
