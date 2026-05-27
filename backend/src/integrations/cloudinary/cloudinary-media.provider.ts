import { BadGatewayException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { UploadApiResponse, v2 as cloudinary } from "cloudinary";
import { ObservabilityService } from "../../modules/observability/observability.service";

export interface CloudinaryUploadInput {
  buffer: Buffer;
  contentType: string;
  publicId: string;
  tags?: string[];
  context?: Record<string, string>;
  eagerTransformations?: CloudinaryEagerTransformation[];
  eagerMode?: "sync" | "async";
}

export interface CloudinaryUploadedAsset {
  publicId: string;
  secureUrl: string;
  bytes: number;
  width: number;
  height: number;
  format: string;
}

export interface CloudinaryEagerTransformation {
  kind: string;
  transformation: string;
}

export interface CloudinaryEagerRendition extends CloudinaryUploadedAsset {
  kind: string;
  transformation: string;
}

export interface CloudinaryOriginalUploadResult extends CloudinaryUploadedAsset {
  version?: number;
  eager: CloudinaryEagerRendition[];
}

type CircuitState = "closed" | "half_open" | "open";

const FAILURE_WINDOW_MS = 60_000;
const OPEN_MS = 60_000;
const FAILURE_THRESHOLD = 5;
// ✅ PERF FIX: Raised from 12s to 30s.
// With eager_async:false and 4 warm renditions, Cloudinary can take 15–20s on
// first-upload of a large image. The 12s limit caused spurious timeouts followed
// by a full retry (retry(fn,1)), doubling the hang to 24s.
const REQUEST_TIMEOUT_MS = 30_000;

@Injectable()
export class CloudinaryMediaProvider {
  private failures: number[] = [];
  private state: CircuitState = "closed";
  private openUntil = 0;
  private readonly uploadPreset?: string;

  constructor(
    config: ConfigService,
    private readonly observability: ObservabilityService
  ) {
    this.uploadPreset = config.get<string>("CLOUDINARY_PRODUCT_UPLOAD_PRESET");
    cloudinary.config({
      cloud_name: config.get<string>("CLOUDINARY_CLOUD_NAME"),
      api_key: config.get<string>("CLOUDINARY_API_KEY"),
      api_secret: config.get<string>("CLOUDINARY_API_SECRET")
    });
    this.reportCircuit();
  }

  isConfigured(): boolean {
    const current = cloudinary.config();
    return Boolean(current.cloud_name && current.api_key && current.api_secret);
  }

  circuitState(): CircuitState {
    if (this.state === "open" && Date.now() >= this.openUntil) {
      this.state = "half_open";
      this.reportCircuit();
    }
    return this.state;
  }

  async uploadOriginalImage(input: CloudinaryUploadInput): Promise<CloudinaryOriginalUploadResult> {
    this.ensureAvailable();
    const started = Date.now();
    try {
      const response = await withTimeout(
        this.uploadStream(input),
        REQUEST_TIMEOUT_MS,
        "Cloudinary upload timed out."
      );
      this.assertUploadResponse(response);
      this.recordSuccess();
      this.observability.recordCloudinaryRequest("upload", "success", Date.now() - started);
      return {
        publicId: response.public_id,
        secureUrl: response.secure_url,
        bytes: response.bytes,
        width: response.width,
        height: response.height,
        format: response.format,
        version: response.version,
        eager: this.mapEager(response, input.eagerTransformations ?? [])
      };
    } catch (error) {
      this.recordFailure();
      this.observability.recordCloudinaryRequest("upload", "failure", Date.now() - started);
      throw error;
    }
  }

  async uploadImage(input: CloudinaryUploadInput): Promise<CloudinaryUploadedAsset> {
    const result = await this.uploadOriginalImage(input);
    return {
      publicId: result.publicId,
      secureUrl: result.secureUrl,
      bytes: result.bytes,
      width: result.width,
      height: result.height,
      format: result.format
    };
  }

  transformedUrl(input: {
    publicId: string;
    transformation: string;
    version?: number;
  }): string {
    return cloudinary.url(input.publicId, {
      secure: true,
      sign_url: false,
      raw_transformation: input.transformation,
      version: input.version
    });
  }

  async destroy(publicId: string): Promise<void> {
    if (!this.isConfigured()) {
      return;
    }
    const started = Date.now();
    try {
      await withTimeout(
        cloudinary.uploader.destroy(publicId, {
          invalidate: true,
          resource_type: "image"
        }),
        5_000,
        "Cloudinary destroy timed out."
      );
      this.observability.recordCloudinaryRequest("destroy", "success", Date.now() - started);
    } catch (error) {
      this.observability.recordCloudinaryRequest("destroy", "failure", Date.now() - started);
      throw error;
    }
  }

  private uploadStream(input: CloudinaryUploadInput): Promise<UploadApiResponse> {
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          public_id: input.publicId,
          // ✅ FIX: overwrite:true is required for retry correctness.
          // If a first attempt partially succeeds (Cloudinary ingests but response
          // is lost), a retry with overwrite:false would fail with "already exists".
          // With overwrite:true the retry succeeds idempotently.
          overwrite: true,
          unique_filename: false,
          resource_type: "image",
          tags: input.tags,
          context: input.context,
          upload_preset: this.uploadPreset,
          // ✅ FIX: Only pass eager options when we have transformations.
          // An empty eager array can cause Cloudinary to behave unexpectedly.
          ...(input.eagerTransformations?.length
            ? {
                eager: input.eagerTransformations.map((item) => item.transformation),
                eager_async: input.eagerMode === "async"
              }
            : {})
        },
        (error, result) => {
          if (error || !result) {
            reject(error ?? new Error("Cloudinary upload returned no result."));
            return;
          }
          resolve(result);
        }
      );
      stream.end(input.buffer);
    });
  }

  private mapEager(
    response: UploadApiResponse,
    eagerTransformations: CloudinaryEagerTransformation[]
  ): CloudinaryEagerRendition[] {
    const eager = Array.isArray(response.eager) ? response.eager : [];
    return eager
      .map((raw: unknown, index: number) => {
        const spec = eagerTransformations[index];
        if (!spec || !isCloudinaryAssetLike(raw)) {
          return null;
        }
        return {
          kind: spec.kind,
          transformation: spec.transformation,
          publicId: response.public_id,
          secureUrl: raw.secure_url,
          bytes: raw.bytes,
          width: raw.width,
          height: raw.height,
          format: raw.format ?? response.format
        };
      })
      .filter((item): item is CloudinaryEagerRendition => Boolean(item));
  }

  private assertUploadResponse(response: UploadApiResponse): asserts response is UploadApiResponse & {
    public_id: string;
    secure_url: string;
    bytes: number;
    width: number;
    height: number;
    format: string;
  } {
    if (
      !response.public_id ||
      !response.secure_url ||
      !response.format ||
      typeof response.bytes !== "number" ||
      typeof response.width !== "number" ||
      typeof response.height !== "number"
    ) {
      throw new BadGatewayException({
        apiVersion: "v1",
        code: "CLOUDINARY_INVALID_RESPONSE",
        message: "Upload provider returned an incomplete image response.",
        retryable: true
      });
    }
  }

  private ensureAvailable() {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException({
        apiVersion: "v1",
        code: "CLOUDINARY_UNAVAILABLE",
        message: "Upload provider is not configured.",
        retryable: false
      });
    }
    const state = this.circuitState();
    if (state === "open") {
      throw new ServiceUnavailableException({
        apiVersion: "v1",
        code: "CLOUDINARY_UNAVAILABLE",
        message: "Upload provider is temporarily unavailable.",
        retryable: true,
        retryAfterSeconds: Math.ceil((this.openUntil - Date.now()) / 1000)
      });
    }
  }

  private recordSuccess() {
    this.failures = [];
    if (this.state !== "closed") {
      this.state = "closed";
      this.reportCircuit();
    }
  }

  private recordFailure() {
    const now = Date.now();
    this.failures = [...this.failures.filter((at) => now - at <= FAILURE_WINDOW_MS), now];
    if (this.failures.length >= FAILURE_THRESHOLD) {
      this.state = "open";
      this.openUntil = now + OPEN_MS;
      this.reportCircuit();
    }
  }

  private reportCircuit() {
    this.observability.setUploadCircuitState("cloudinary", this.state);
  }
}

function isCloudinaryAssetLike(value: unknown): value is {
  secure_url: string;
  bytes: number;
  width: number;
  height: number;
  format?: string;
} {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.secure_url === "string" &&
    typeof candidate.bytes === "number" &&
    typeof candidate.width === "number" &&
    typeof candidate.height === "number"
  );
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      })
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
