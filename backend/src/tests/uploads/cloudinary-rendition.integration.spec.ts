import { UploadPurpose } from "@prisma/client";
import { CloudinaryMediaProvider } from "@/integrations/cloudinary/cloudinary-media.provider";
import { ObservabilityService } from "@/modules/observability/observability.service";
import { renditionTransformation, UploadPolicyRegistry } from "@/modules/uploads/upload-policy.registry";
import sharp = require("sharp");

const hasCloudinaryCredentials = Boolean(
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET
);

const maybeIt = hasCloudinaryCredentials ? it : it.skip;

describe("Cloudinary product rendition integration", () => {
  maybeIt("serves every generated product rendition URL as an image", async () => {
    const observability = {
      recordCloudinaryRequest: jest.fn(),
      setUploadCircuitState: jest.fn()
    } as unknown as ObservabilityService;
    const provider = new CloudinaryMediaProvider({
      get: (key: string) => process.env[key]
    } as never, observability);
    const policy = new UploadPolicyRegistry().get(UploadPurpose.PRODUCT_IMAGE);
    const buffer = await sharp({
      create: {
        background: "#fff",
        channels: 3,
        height: 800,
        width: 800
      }
    }).jpeg().toBuffer();
    const publicId = `lotzi-tests/uploads/${Date.now()}-${Math.random().toString(36).slice(2)}/original`;

    const original = await provider.uploadOriginalImage({
      buffer,
      contentType: "image/jpeg",
      publicId,
      tags: ["lotzi-test"],
      eagerTransformations: policy.renditions
        .filter((rendition) => rendition.warmOnUpload)
        .map((rendition) => ({
          kind: rendition.kind,
          transformation: renditionTransformation(rendition)
        }))
    });

    try {
      for (const rendition of policy.renditions) {
        const transformation = renditionTransformation(rendition);
        const warmed = original.eager.find((item) => item.kind === rendition.kind);
        const url = warmed?.secureUrl ?? provider.transformedUrl({
          publicId: original.publicId,
          transformation,
          version: original.version
        });
        const response = await fetchWithRetry(url);
        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toMatch(/^image\//);
        const metadata = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
        expect(metadata.width).toBeLessThanOrEqual(rendition.maxDimension);
        expect(metadata.height).toBeLessThanOrEqual(rendition.maxDimension);
      }
    } finally {
      await provider.destroy(original.publicId).catch(() => undefined);
    }
  }, 60_000);
});

async function fetchWithRetry(url: string): Promise<Response> {
  let last: Response | undefined;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    last = await fetch(url);
    if (last.status === 200 || (last.status !== 420 && last.status < 500)) {
      return last;
    }
    await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
  }
  return last!;
}
