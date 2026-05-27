import { HttpStatus, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import {
  AuditOutcome,
  Prisma,
  StoreStatus,
  UploadAssetStatus,
  UploadProvider,
  UploadPurpose,
  UploadRenditionKind
} from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import sharp = require("sharp");
import { PrismaService } from "../../database/prisma.service";
import {
  CloudinaryMediaProvider,
  CloudinaryOriginalUploadResult
} from "../../integrations/cloudinary/cloudinary-media.provider";
import { AuditService } from "../audit/audit.service";
import { AuthenticatedPrincipal } from "../auth/auth.types";
import { ObservabilityService } from "../observability/observability.service";
import { RateLimitService } from "../rate-limit/rate-limit.service";
import { RbacEngine } from "../rbac/rbac.engine";
import { UploadImageDto } from "./dto/uploads.dto";
import { IdempotencyService } from "./idempotency.service";
import { ProcessingSemaphore } from "./processing-semaphore.service";
import { renditionTransformation, RenditionSpec, UploadPolicyRegistry } from "./upload-policy.registry";
import { uploadError } from "./uploads.errors";

interface UploadResult {
  body: unknown;
  serverTiming: string;
}

interface StageTiming {
  stage: string;
  durationMs: number;
}

interface UploadedRendition {
  kind: UploadRenditionKind;
  format: "webp" | "jpeg";
  secureUrl: string;
  transformation: string;
  width: number;
  height: number;
  bytes: number | null;
  providerPublicId?: string | null;
}

const CLEANUP_INTERVAL_MS = 15 * 60 * 1000;
const CLEANUP_ELIGIBLE_AFTER_MS = 15 * 60 * 1000;
const CLEANUP_ALERT_AFTER_MS = 2 * 60 * 60 * 1000;
const CLEANUP_MAX_ATTEMPTS = 5;

@Injectable()
export class UploadEngineService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(UploadEngineService.name);
  private cleanupTimer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly policies: UploadPolicyRegistry,
    private readonly cloudinary: CloudinaryMediaProvider,
    private readonly idempotency: IdempotencyService,
    private readonly rateLimit: RateLimitService,
    private readonly rbac: RbacEngine,
    private readonly semaphore: ProcessingSemaphore,
    private readonly observability: ObservabilityService,
    private readonly audit: AuditService
  ) {}

  onModuleInit() {
    this.cleanupTimer = setInterval(() => {
      void this.sweepUploadCleanup({ maxAssets: 25, maxMs: 10_000 }).catch((error) => {
        this.logger.warn(
          `Upload cleanup sweep failed: ${error instanceof Error ? error.message : String(error)}`
        );
      });
    }, CLEANUP_INTERVAL_MS);
    this.cleanupTimer.unref?.();
  }

  onModuleDestroy() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
  }

  capabilities() {
    const formats = sharp.format;
    return {
      apiVersion: "v1",
      provider: "sharp-libvips",
      input: {
        jpeg: Boolean(formats.jpeg?.input.buffer),
        png: Boolean(formats.png?.input.buffer),
        webp: Boolean(formats.webp?.input.buffer),
        gif: Boolean(formats.gif?.input.buffer),
        tiff: Boolean(formats.tiff?.input.buffer),
        avif: Boolean(formats.avif?.input.buffer),
        heif: Boolean(formats.heif?.input.buffer)
      },
      policies: this.policies.listCapabilities()
    };
  }

  async uploadImage(input: {
    auth: AuthenticatedPrincipal;
    file?: Express.Multer.File;
    dto: UploadImageDto;
    requestId?: string;
    signal?: AbortSignal;
  }): Promise<UploadResult> {
    const requestStarted = Date.now();
    const timings: StageTiming[] = [];
    const purpose = UploadPurpose.PRODUCT_IMAGE;
    const policy = this.policies.get(purpose);
    const release = this.semaphore.tryAcquire();
    if (!release) {
      throw uploadError(
        HttpStatus.TOO_MANY_REQUESTS,
        "UPLOAD_PROCESSING_BUSY",
        "Image processing is busy. Please retry in a few seconds.",
        true,
        { retryAfterSeconds: 3 }
      );
    }

    const idempotencyKey = input.dto.idempotencyKey;
    let reservation:
      | Extract<Awaited<ReturnType<IdempotencyService["reserve"]>>, { state: "reserved" }>
      | undefined;
    let uploadAssetId: string | undefined;
    let uploaded: UploadedRendition[] = [];
    let original: CloudinaryOriginalUploadResult | undefined;
    let sourceFormat = "unknown";

    try {
      const file = input.file;
      if (!file?.buffer?.length) {
        throw uploadError(HttpStatus.BAD_REQUEST, "UPLOAD_FILE_MISSING", "Attach one image file.");
      }
      this.assertNotAborted(input.signal);
      await this.stage(timings, purpose, "rate-limit", sourceFormat, () =>
        this.rateLimit.enforce(`upload:v1:${input.dto.storeId}:${input.auth.userId}`, 20, 60)
      );
      await this.stage(timings, purpose, "store-access", sourceFormat, () =>
        this.assertStoreAccess(input.auth, input.dto.storeId, policy.requiredPermissions)
      );

      if (file.size > policy.maxBytes) {
        throw uploadError(HttpStatus.BAD_REQUEST, "UPLOAD_TOO_LARGE", "Image exceeds the 12 MB product image limit.");
      }

      const sourceSha256 = await this.stage(timings, purpose, "hash", sourceFormat, () =>
        Promise.resolve(sha256(file.buffer))
      );
      const requestHash = sha256Text(`${sourceSha256}.${canonicalJson({
        byteSize: file.size,
        clientFileId: input.dto.clientFileId,
        declaredMimeType: input.dto.declaredMimeType ?? file.mimetype,
        draftId: input.dto.draftId,
        originalFilename: file.originalname,
        purpose: input.dto.purpose,
        storeId: input.dto.storeId
      })}`);

      const reserved = await this.stage(timings, purpose, "idempotency", sourceFormat, () =>
        this.idempotency.reserve({
          key: idempotencyKey,
          storeId: input.dto.storeId,
          userId: input.auth.userId,
          operation: "upload.image.v1",
          requestHash
        })
      );
      if (reserved.state === "replayed") {
        timings.push({ stage: "total", durationMs: Date.now() - requestStarted });
        return {
          body: reserved.response,
          serverTiming: serverTiming(timings)
        };
      }
      reservation = reserved;

      const magic = await this.stage(timings, purpose, "magic-byte", sourceFormat, () =>
        Promise.resolve(sniffImage(file.buffer))
      );
      sourceFormat = magic.mimeType.split("/")[1] ?? "unknown";
      if (!policy.allowedMagicTypes.includes(magic.mimeType)) {
        throw uploadError(HttpStatus.BAD_REQUEST, "UPLOAD_UNSUPPORTED_FORMAT", "This image format is not supported.");
      }
      const declaredTypes = [file.mimetype, input.dto.declaredMimeType].filter((value): value is string => Boolean(value));
      const declaredAllowed = declaredTypes.some((value) =>
        policy.allowedMimeTypes.includes(value) || value === "application/octet-stream"
      );
      if (declaredTypes.length > 0 && !declaredAllowed) {
        throw uploadError(HttpStatus.BAD_REQUEST, "UPLOAD_MIME_SPOOFED", "The declared file type does not match an allowed image type.");
      }
      this.assertRuntimeSupports(magic.mimeType);

      const metadata = await this.stage(timings, purpose, "decode", sourceFormat, () =>
        sharp(file.buffer, { limitInputPixels: policy.maxPixels, pages: 1 }).metadata()
      ).catch((error) => {
        throw uploadError(
          HttpStatus.BAD_REQUEST,
          "UPLOAD_CORRUPT_IMAGE",
          "Image could not be decoded safely.",
          false,
          { cause: error instanceof Error ? error.message : String(error) }
        );
      });

      const width = metadata.width ?? 0;
      const height = metadata.height ?? 0;
      await this.stage(timings, purpose, "validate", sourceFormat, async () => {
        this.validateDimensions(policy, width, height);
        const customIssues = policy.validate
          ? await policy.validate({
              width,
              height,
              bytes: file.size,
              mimeType: magic.mimeType,
              sourceSha256
            })
          : [];
        if (customIssues[0]) {
          throw uploadError(HttpStatus.BAD_REQUEST, customIssues[0].code, customIssues[0].message);
        }
      });

      uploadAssetId = randomUUID();
      const assetId = uploadAssetId;
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

      const folder = policy.folder({ storeId: input.dto.storeId, uploadAssetId: assetId });
      original = await this.stage(timings, purpose, "cloudinary-upload", sourceFormat, async () => {
        this.assertNotAborted(input.signal);
        const result = await retry(
          () =>
            this.cloudinary.uploadOriginalImage({
              buffer: file.buffer,
              contentType: magic.mimeType,
              publicId: `${folder}/original`,
              tags: ["namastore", purpose.toLowerCase()],
              context: {
                storeId: input.dto.storeId,
                uploadAssetId: assetId,
                purpose
              },
              eagerMode: "async",
              eagerTransformations: policy.renditions
                .filter((rendition) => rendition.warmOnUpload)
                .map((rendition) => ({
                  kind: rendition.kind,
                  transformation: renditionTransformation(rendition)
                }))
            }),
          // ✅ FIX: 0 retries (= 1 attempt only).
          // Previously retry(fn, 1) = 2 attempts × 30s timeout = 60s hang on failure.
          // Client retries via idempotency key is the correct pattern:
          // - If upload succeeded but response was lost → idempotency replay returns cached response instantly
          // - If upload truly failed → client shows error, user can retry manually
          0
        );
        this.observability.recordUploadBytes(purpose, result.format, "ORIGINAL", result.bytes);
        return result;
      });
      this.assertNotAborted(input.signal);
      uploaded = this.buildRenditionMetadata(original, policy.renditions, width, height, {
        requireEagerRenditions: false
      });
      const uploadedOriginal = original;

      const response = await this.stage(timings, purpose, "db-write", sourceFormat, () =>
        this.persistReadyAsset({
          uploadAssetId: assetId,
          storeId: input.dto.storeId,
          uploadedByUserId: input.auth.userId,
          purpose,
          sourceSha256,
          originalFilename: sanitizeFilename(file.originalname),
          draftId: input.dto.draftId,
          clientFileId: input.dto.clientFileId,
          mimeType: magic.mimeType,
          width,
          height,
          bytes: file.size,
          original: uploadedOriginal,
          renditions: uploaded,
          expiresAt
        })
      ).catch(async (error) => {
        await this.destroyOriginal(original).catch(() => undefined);
        throw error;
      });


      await this.stage(timings, purpose, "idempotency-complete", sourceFormat, () =>
        this.idempotency.complete(reservation, response)
      );
      await this.stage(timings, purpose, "observability-audit", sourceFormat, async () => {
        this.observability.recordUploadRequest(purpose, "success", "complete", sourceFormat);
        this.audit.record({
          eventType: "upload.image.ready",
          actorUserId: input.auth.userId,
          storeId: input.dto.storeId,
          outcome: AuditOutcome.SUCCESS,
          requestId: input.requestId,
          metadata: { uploadAssetId, purpose } as Prisma.InputJsonObject
        });
      });
      timings.push({ stage: "total", durationMs: Date.now() - requestStarted });
      return {
        body: response,
        serverTiming: serverTiming(timings)
      };
    } catch (error) {
      this.observability.recordUploadRequest(purpose, "failure", "error", sourceFormat);
      this.observability.recordUploadFailure(purpose, failureCategory(error));
      if (original) {
        await this.destroyOriginal(original).catch(() => undefined);
      }

      if (reservation) {
        await this.idempotency.fail(reservation, errorResponse(error)).catch(() => undefined);
      }
      this.audit.record({
        eventType: "upload.image.failed",
        actorUserId: input.auth.userId,
        storeId: input.dto.storeId,
        outcome: AuditOutcome.FAILURE,
        requestId: input.requestId,
        metadata: {
          uploadAssetId: uploadAssetId ?? null,
          purpose,
          failureCategory: failureCategory(error)
        } as Prisma.InputJsonObject
      });
      throw error;
    } finally {
      release();
    }
  }

  async sweepStoreOrphans(storeId: string, options: { maxAssets?: number; maxMs?: number } = {}) {
    return this.sweepUploadCleanup({ ...options, storeId });
  }

  async sweepUploadCleanup(options: { storeId?: string; maxAssets?: number; maxMs?: number } = {}) {
    const maxAssets = options.maxAssets ?? 10;
    const maxMs = options.maxMs ?? 500;
    const started = Date.now();
    const cutoff = new Date(Date.now() - CLEANUP_ELIGIBLE_AFTER_MS);
    const alertCutoff = new Date(Date.now() - CLEANUP_ALERT_AFTER_MS);
    const now = new Date();
    const assets = await this.prisma.uploadAsset.findMany({
      where: {
        storeId: options.storeId,
        cleanupSucceededAt: null,
        cleanupAttemptCount: { lt: CLEANUP_MAX_ATTEMPTS },
        AND: [
          {
            OR: [
              {
                status: { in: [UploadAssetStatus.TEMP, UploadAssetStatus.ORPHANED, UploadAssetStatus.REJECTED] },
                updatedAt: { lt: cutoff }
              },
              {
                status: UploadAssetStatus.READY,
                expiresAt: { lt: now },
                productImage: null
              }
            ]
          },
          {
            OR: [
              { originalProviderPublicId: { not: null } },
              { renditions: { some: { providerPublicId: { not: null } } } }
            ]
          }
        ]
      },
      include: { renditions: true },
      orderBy: { createdAt: "asc" },
      take: maxAssets
    });
    let cleaned = 0;
    let failed = 0;
    let deadLettered = 0;
    for (const asset of assets) {
      if (Date.now() - started >= maxMs) {
        break;
      }
      await this.prisma.uploadAsset.update({
        where: { id: asset.id },
        data: {
          cleanupAttemptedAt: new Date(),
          cleanupAttemptCount: { increment: 1 }
        }
      }).catch(() => undefined);
      try {
        const publicIds = cleanupPublicIds(asset);
        for (const publicId of publicIds) {
          if (Date.now() - started >= maxMs) {
            break;
          }
          await this.cloudinary.destroy(publicId);
        }
        await this.prisma.uploadAsset.update({
          where: { id: asset.id },
          data: {
            status: asset.status === UploadAssetStatus.ATTACHED ? asset.status : UploadAssetStatus.REJECTED,
            failureReason: asset.status === UploadAssetStatus.READY ? "expired_unattached" : asset.failureReason ?? "swept_orphan",
            cleanupSucceededAt: new Date(),
            cleanupLastError: null
          }
        }).catch(() => undefined);
        cleaned += 1;
      } catch (error) {
        failed += 1;
        const attemptCount = asset.cleanupAttemptCount + 1;
        if (attemptCount >= CLEANUP_MAX_ATTEMPTS) {
          deadLettered += 1;
        }
        const message = error instanceof Error ? error.message : String(error);
        this.observability.recordUploadCleanupFailed(asset.purpose, attemptCount >= CLEANUP_MAX_ATTEMPTS ? "dead_letter" : "retryable");
        await this.prisma.uploadAsset.update({
          where: { id: asset.id },
          data: {
            cleanupLastError: message.slice(0, 500)
          }
        }).catch(() => undefined);
      }
    }
    const olderThan2h = await this.prisma.uploadAsset.count({
      where: {
        storeId: options.storeId,
        cleanupSucceededAt: null,
        originalProviderPublicId: { not: null },
        updatedAt: { lt: alertCutoff },
        OR: [
          { status: { in: [UploadAssetStatus.ORPHANED, UploadAssetStatus.REJECTED] } },
          { status: UploadAssetStatus.READY, expiresAt: { lt: now }, productImage: null }
        ]
      }
    }).catch(() => 0);
    this.observability.setUploadOrphanOriginals("older_than_2h", olderThan2h);
    this.logger.log(JSON.stringify({
      event: "upload.orphan_sweep",
      storeId: options.storeId,
      scanned: assets.length,
      cleaned,
      failed,
      deadLettered,
      durationMs: Date.now() - started
    }));
    return { apiVersion: "v1", cleaned, failed, deadLettered, scanned: assets.length };
  }

  private async assertStoreAccess(auth: AuthenticatedPrincipal, storeId: string, required: string[]) {
    const [store, authorization] = await Promise.all([
      this.prisma.store.findFirst({
        where: {
          id: storeId,
          deletedAt: null,
          status: { in: [StoreStatus.APPROVED, StoreStatus.PENDING] }
        },
        select: { id: true }
      }),
      this.rbac.storeAuthorization(auth.userId, storeId, auth.authzVersion)
    ]);
    if (!store) {
      throw uploadError(HttpStatus.NOT_FOUND, "STORE_NOT_FOUND", "Store not found.");
    }
    if (!this.rbac.hasPermissions(authorization.permissions, required)) {
      throw uploadError(HttpStatus.FORBIDDEN, "UPLOAD_FORBIDDEN", "You do not have permission to upload media for this store.");
    }
  }

  private validateDimensions(policy: ReturnType<UploadPolicyRegistry["get"]>, width: number, height: number) {
    if (!width || !height) {
      throw uploadError(HttpStatus.BAD_REQUEST, "UPLOAD_CORRUPT_IMAGE", "Image dimensions could not be read.");
    }
    if (width * height > policy.maxPixels) {
      throw uploadError(HttpStatus.BAD_REQUEST, "UPLOAD_PIXEL_LIMIT_EXCEEDED", "Image has too many pixels to process safely.");
    }
    if (policy.minWidth && width < policy.minWidth) {
      throw uploadError(HttpStatus.BAD_REQUEST, "UPLOAD_DIMENSIONS_TOO_SMALL", `Image must be at least ${policy.minWidth}px wide.`);
    }
    if (policy.minHeight && height < policy.minHeight) {
      throw uploadError(HttpStatus.BAD_REQUEST, "UPLOAD_DIMENSIONS_TOO_SMALL", `Image must be at least ${policy.minHeight}px tall.`);
    }
    if (policy.aspectRatio) {
      const ratio = width / height;
      if (ratio < policy.aspectRatio.min || ratio > policy.aspectRatio.max) {
        throw uploadError(HttpStatus.BAD_REQUEST, "UPLOAD_ASPECT_RATIO_UNSUPPORTED", "Image aspect ratio is outside the allowed product range.");
      }
    }
  }

  private assertRuntimeSupports(mimeType: string) {
    const formats = sharp.format;
    if ((mimeType === "image/heic" || mimeType === "image/heif") && !formats.heif?.input.buffer) {
      throw uploadError(HttpStatus.BAD_REQUEST, "UPLOAD_UNSUPPORTED_FORMAT", "HEIC is not supported by this deployment. Please convert to JPG or WebP.");
    }
    if (mimeType === "image/avif" && !formats.avif?.input.buffer) {
      throw uploadError(HttpStatus.BAD_REQUEST, "UPLOAD_UNSUPPORTED_FORMAT", "AVIF is not supported by this deployment. Please convert to JPG or WebP.");
    }
  }

  private buildRenditionMetadata(
    original: CloudinaryOriginalUploadResult,
    specs: RenditionSpec[],
    sourceWidth: number,
    sourceHeight: number,
    options: { requireEagerRenditions?: boolean } = {}
  ): UploadedRendition[] {
    const requireEagerRenditions = options.requireEagerRenditions ?? true;
    const eagerByKind = new Map(original.eager.map((rendition) => [rendition.kind, rendition]));
    return specs.map((spec) => {
      const transformation = renditionTransformation(spec);
      const eager = eagerByKind.get(spec.kind);
      if (requireEagerRenditions && spec.warmOnUpload && !eager) {
        throw uploadError(
          HttpStatus.BAD_GATEWAY,
          "CLOUDINARY_EAGER_INCOMPLETE",
          "Upload provider did not return all warmed image renditions.",
          true,
          { rendition: spec.kind }
        );
      }
      const dimensions = eager ?? fitInside(sourceWidth, sourceHeight, spec.maxDimension);
      return {
        kind: spec.kind,
        format: spec.format,
        secureUrl: eager?.secureUrl ?? this.cloudinary.transformedUrl({
          publicId: original.publicId,
          transformation,
          version: original.version
        }),
        transformation,
        width: dimensions.width,
        height: dimensions.height,
        bytes: eager?.bytes ?? null,
        providerPublicId: null
      };
    });
  }

  private async persistReadyAsset(input: {
    uploadAssetId: string;
    storeId?: string;
    uploadedByUserId: string;
    purpose: UploadPurpose;
    sourceSha256: string;
    originalFilename: string;
    draftId?: string;
    clientFileId?: string;
    mimeType: string;
    width: number;
    height: number;
    bytes: number;
    expiresAt: Date;
    original: CloudinaryOriginalUploadResult;
    renditions: UploadedRendition[];
  }) {
    this.assertPersistableRenditions(input.renditions);
    await this.prisma.$transaction([
      this.prisma.uploadAsset.create({
        data: {
          id: input.uploadAssetId,
          storeId: input.storeId,
          uploadedByUserId: input.uploadedByUserId,
          purpose: input.purpose,
          status: UploadAssetStatus.READY,
          sourceSha256: input.sourceSha256,
          originalFilename: input.originalFilename,
          draftId: input.draftId,
          clientFileId: input.clientFileId,
          mimeType: input.mimeType,
          width: input.width,
          height: input.height,
          bytes: input.bytes,
          originalProviderPublicId: input.original.publicId,
          originalSecureUrl: input.original.secureUrl,
          expiresAt: input.expiresAt
        }
      }),
      this.prisma.uploadAssetRendition.createMany({
        data: input.renditions.map((rendition) => ({
          kind: rendition.kind,
          provider: UploadProvider.CLOUDINARY,
          providerPublicId: rendition.providerPublicId,
          secureUrl: rendition.secureUrl,
          transformation: rendition.transformation,
          format: rendition.format,
          width: rendition.width,
          height: rendition.height,
          bytes: rendition.bytes,
          uploadAssetId: input.uploadAssetId
        }))
      })
    ]);
    return {
      apiVersion: "v1",
      asset: {
        id: input.uploadAssetId,
        purpose: input.purpose,
        status: "READY",
        sourceSha256: input.sourceSha256,
        originalFilename: input.originalFilename,
        mimeType: input.mimeType,
        width: input.width,
        height: input.height,
        bytes: input.bytes,
        expiresAt: input.expiresAt.toISOString(),
        renditions: Object.fromEntries(input.renditions.map((rendition) => [
          renditionKey(rendition.kind),
          {
            kind: rendition.kind,
            secureUrl: rendition.secureUrl,
            width: rendition.width,
            height: rendition.height,
            bytes: rendition.bytes,
            format: rendition.format
          }
        ]))
      }
    };
  }

  private async destroyOriginal(original?: CloudinaryOriginalUploadResult) {
    if (original?.publicId) {
      await this.cloudinary.destroy(original.publicId);
    }
  }

  private assertPersistableRenditions(
    renditions: UploadedRendition[]
  ): asserts renditions is UploadedRendition[] {
    if (!renditions.length) {
      throw uploadError(
        HttpStatus.SERVICE_UNAVAILABLE,
        "UPLOAD_PROVIDER_INCOMPLETE",
        "Upload provider did not return any image renditions.",
        true
      );
    }
    const missingUrl = renditions.find((rendition) => !rendition.secureUrl);
    if (missingUrl) {
      throw uploadError(
        HttpStatus.SERVICE_UNAVAILABLE,
        "UPLOAD_PROVIDER_INCOMPLETE",
        "Upload provider did not return metadata for every image rendition.",
        true,
        { rendition: missingUrl.kind }
      );
    }
  }

  private markAsset(id: string, status: UploadAssetStatus, reason: string) {
    return this.prisma.uploadAsset.update({
      where: { id },
      data: { status, failureReason: reason }
    });
  }

  private assertNotAborted(signal?: AbortSignal) {
    if (signal?.aborted) {
      throw uploadError(HttpStatus.BAD_REQUEST, "UPLOAD_CLIENT_ABORTED", "Upload was cancelled by the client.", true);
    }
  }

  private async stage<T>(
    timings: StageTiming[],
    purpose: string,
    stage: string,
    format: string,
    fn: () => Promise<T>
  ): Promise<T> {
    const started = Date.now();
    try {
      return await fn();
    } finally {
      const durationMs = Date.now() - started;
      timings.push({ stage, durationMs });
      this.observability.observeUploadStage(purpose, stage, format, durationMs);
    }
  }
}

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value: Record<string, unknown>): string {
  return JSON.stringify(Object.keys(value).sort().reduce<Record<string, unknown>>((acc, key) => {
    acc[key] = value[key];
    return acc;
  }, {}));
}

function sniffImage(buffer: Buffer): { mimeType: string } {
  if (buffer.length < 12) {
    throw uploadError(HttpStatus.BAD_REQUEST, "UPLOAD_CORRUPT_IMAGE", "Image file is incomplete.");
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mimeType: "image/jpeg" };
  }
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mimeType: "image/png" };
  }
  if (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    return { mimeType: "image/webp" };
  }
  const gif = buffer.subarray(0, 6).toString("ascii");
  if (gif === "GIF87a" || gif === "GIF89a") {
    return { mimeType: "image/gif" };
  }
  if (
    buffer.subarray(0, 4).equals(Buffer.from([0x49, 0x49, 0x2a, 0x00])) ||
    buffer.subarray(0, 4).equals(Buffer.from([0x4d, 0x4d, 0x00, 0x2a]))
  ) {
    return { mimeType: "image/tiff" };
  }
  if (buffer.subarray(4, 8).toString("ascii") === "ftyp") {
    const brands = [
      buffer.subarray(8, 12).toString("ascii"),
      buffer.subarray(16, Math.min(buffer.length, 64)).toString("ascii")
    ].join(" ");
    if (brands.includes("avif") || brands.includes("avis")) {
      return { mimeType: "image/avif" };
    }
    if (/(heic|heix|hevc|hevx|mif1|msf1)/.test(brands)) {
      return { mimeType: "image/heic" };
    }
  }
  throw uploadError(HttpStatus.BAD_REQUEST, "UPLOAD_UNSUPPORTED_FORMAT", "Only common image files are supported.");
}

function sanitizeFilename(value: string): string {
  const cleaned = value.replace(/[^\w.\- ()]/g, "_").replace(/\s+/g, " ").trim();
  return cleaned.slice(0, 180) || "image";
}

function fitInside(width: number, height: number, maxDimension: number): { width: number; height: number } {
  if (width <= maxDimension && height <= maxDimension) {
    return { width, height };
  }
  const scale = maxDimension / Math.max(width, height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
}

function cleanupPublicIds(asset: {
  originalProviderPublicId: string | null;
  renditions: Array<{ providerPublicId: string | null }>;
}): string[] {
  return Array.from(
    new Set([
      asset.originalProviderPublicId,
      ...asset.renditions.map((rendition) => rendition.providerPublicId)
    ].filter((value): value is string => Boolean(value)))
  );
}

function renditionKey(kind: UploadRenditionKind): string {
  if (kind === UploadRenditionKind.JPEG_FALLBACK) {
    return "jpegFallback";
  }
  return kind.toLowerCase().replace(/_([a-z])/g, (_, char: string) => char.toUpperCase());
}

async function retry<T>(fn: () => Promise<T>, attempts: number): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
      }
    }
  }
  throw lastError;
}

function serverTiming(timings: StageTiming[]): string {
  return timings.map((item) => `${item.stage};dur=${item.durationMs}`).join(", ");
}

function failureCategory(error: unknown): string {
  if (error && typeof error === "object" && "response" in error) {
    const response = (error as { response?: unknown }).response;
    if (response && typeof response === "object" && "code" in response) {
      return String((response as { code?: unknown }).code);
    }
  }
  return error instanceof Error ? error.name : "unknown";
}

function errorResponse(error: unknown): unknown {
  if (error && typeof error === "object" && "response" in error) {
    return (error as { response?: unknown }).response;
  }
  return {
    apiVersion: "v1",
    code: "UPLOAD_FAILED",
    message: error instanceof Error ? error.message : "Upload failed.",
    retryable: false
  };
}
