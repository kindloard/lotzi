import { HttpException } from "@nestjs/common";
import { StoreStatus, UploadPurpose, UploadRenditionKind } from "@prisma/client";
import { UploadEngineService } from "@/modules/uploads/upload-engine.service";
import { UploadPolicyRegistry } from "@/modules/uploads/upload-policy.registry";
import { PERMISSIONS } from "@/modules/rbac/permissions";
import sharp = require("sharp");

describe("UploadEngineService provider safety", () => {
  it("reports sharp capabilities without relying on a synthetic default import", () => {
    const service = new UploadEngineService(
      {} as never,
      { listCapabilities: () => [] } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );

    expect(service.capabilities()).toMatchObject({
      apiVersion: "v1",
      provider: "sharp-libvips",
      input: {
        jpeg: expect.any(Boolean),
        png: expect.any(Boolean),
        webp: expect.any(Boolean)
      },
      policies: []
    });
  });

  it("fails closed when provider metadata is missing before persistence", async () => {
    const service = new UploadEngineService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );

    try {
      await (service as unknown as {
        persistReadyAsset(input: unknown): Promise<unknown>;
      }).persistReadyAsset({
        uploadAssetId: "35aa44f1-25bb-4830-a1c0-f3a5c783b218",
        purpose: UploadPurpose.PRODUCT_IMAGE,
        sourceSha256: "hash",
        originalFilename: "image.jpg",
        mimeType: "image/jpeg",
        width: 800,
        height: 800,
        bytes: 1024,
        expiresAt: new Date(),
        original: {
          publicId: "stores/store-1/uploads/asset-1/original",
          secureUrl: "https://res.cloudinary.com/demo/image/upload/original",
          bytes: 1024,
          width: 800,
          height: 800,
          format: "jpg",
          eager: []
        },
        renditions: [{
          kind: UploadRenditionKind.CARD,
          format: "webp",
          width: 640,
          height: 640,
          bytes: null,
          secureUrl: "",
          transformation: "c_limit,w_640,h_640,f_webp,q_84"
        }]
      });
      throw new Error("Expected persistReadyAsset to reject.");
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      if (!(error instanceof HttpException)) {
        throw error;
      }
      const response = error.getResponse();
      expect(response).toMatchObject({ code: "UPLOAD_PROVIDER_INCOMPLETE" });
    }
  });

  it("still rejects missing warmed renditions when synchronous eager metadata is required", () => {
    const service = new UploadEngineService(
      {} as never,
      new UploadPolicyRegistry(),
      {
        transformedUrl: jest.fn(({ transformation }) => `https://res.cloudinary.com/demo/image/upload/${transformation}/v1/original`)
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );

    const policy = new UploadPolicyRegistry().get(UploadPurpose.PRODUCT_IMAGE);

    expect(() =>
      (service as unknown as {
        buildRenditionMetadata(
          original: unknown,
          specs: unknown,
          sourceWidth: number,
          sourceHeight: number
        ): unknown;
      }).buildRenditionMetadata({
        publicId: "stores/store-1/uploads/asset-1/original",
        secureUrl: "https://res.cloudinary.com/demo/image/upload/v1/original",
        bytes: 1024,
        width: 800,
        height: 800,
        format: "jpg",
        version: 1,
        eager: []
      }, policy.renditions, 800, 800)
    ).toThrow(HttpException);
  });

  it("uploads independent attempts and allows repeated image bytes", async () => {
    const buffer = await sharp({
      create: {
        background: "#fff",
        channels: 3,
        height: 800,
        width: 800
      }
    }).jpeg().toBuffer();
    const prisma = {
      store: { findFirst: jest.fn().mockResolvedValue({ id: "store-1" }) },
      uploadAsset: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({})
      },
      uploadAssetRendition: {
        createMany: jest.fn().mockResolvedValue({ count: 5 })
      },
      $transaction: jest.fn((ops: Array<Promise<unknown>>) => Promise.all(ops))
    };
    const cloudinary = {
      uploadOriginalImage: jest.fn().mockResolvedValue({
        publicId: "stores/1fc57307-2833-4a96-a7c6-810bcdc2d206/uploads/asset/original",
        secureUrl: "https://res.cloudinary.com/demo/image/upload/v1/original",
        bytes: buffer.length,
        width: 800,
        height: 800,
        format: "jpg",
        version: 1,
        eager: []
      }),
      transformedUrl: jest.fn(({ transformation }) => `https://res.cloudinary.com/demo/image/upload/${transformation}/v1/original`),
      destroy: jest.fn()
    };
    const service = new UploadEngineService(
      prisma as never,
      new UploadPolicyRegistry(),
      cloudinary as never,
      {
        reserve: jest.fn().mockResolvedValue({
          state: "reserved",
          key: "91973d2a-2511-42b7-bc08-9aa2b2722fb7",
          backend: "redis",
          reservationId: "reservation-1",
          userId: "3f9d58cf-65e1-4a9b-bf87-a777d32af171",
          storeId: "1fc57307-2833-4a96-a7c6-810bcdc2d206",
          operation: "upload.image.v1",
          requestHash: "hash"
        }),
        complete: jest.fn(),
        fail: jest.fn()
      } as never,
      { enforce: jest.fn() } as never,
      {
        storeAuthorization: jest.fn().mockResolvedValue({
          permissions: [PERMISSIONS.PRODUCT_MANAGE],
          storeDeletedAt: null,
          storeExists: true,
          storeStatus: StoreStatus.APPROVED
        }),
        hasPermissions: jest.fn().mockReturnValue(true)
      } as never,
      { tryAcquire: jest.fn(() => jest.fn()) } as never,
      {
        observeUploadStage: jest.fn(),
        recordUploadBytes: jest.fn(),
        recordUploadRequest: jest.fn(),
        recordUploadFailure: jest.fn()
      } as never,
      { record: jest.fn() } as never
    );

    const result = await service.uploadImage({
      auth: {
        authzVersion: 1,
        isPlatformAdmin: false,
        permissions: [PERMISSIONS.PRODUCT_MANAGE],
        roleCodes: [],
        sessionId: "session-1",
        tokenFamilyId: "token-family-1",
        userId: "3f9d58cf-65e1-4a9b-bf87-a777d32af171"
      } as never,
      dto: {
        purpose: "PRODUCT_IMAGE",
        storeId: "1fc57307-2833-4a96-a7c6-810bcdc2d206",
        draftId: "draft-1",
        clientFileId: "40754379-ea32-44df-9026-b9571d7c7871",
        idempotencyKey: "91973d2a-2511-42b7-bc08-9aa2b2722fb7",
        declaredMimeType: "image/jpeg"
      },
      file: {
        buffer,
        mimetype: "image/jpeg",
        originalname: "product.jpg",
        size: buffer.length
      } as Express.Multer.File
    });

    expect(cloudinary.uploadOriginalImage).toHaveBeenCalledTimes(1);
    expect(cloudinary.uploadOriginalImage.mock.calls[0][0]).toMatchObject({ eagerMode: "async" });
    expect(cloudinary.uploadOriginalImage.mock.calls[0][0].eagerTransformations).toEqual([
      { kind: UploadRenditionKind.THUMBNAIL, transformation: "c_limit,w_160,h_160,f_webp,q_82" },
      { kind: UploadRenditionKind.CARD, transformation: "c_limit,w_640,h_640,f_webp,q_84" },
      { kind: UploadRenditionKind.DETAIL, transformation: "c_limit,w_1200,h_1200,f_webp,q_86" },
      { kind: UploadRenditionKind.JPEG_FALLBACK, transformation: "c_limit,w_1200,h_1200,f_jpg,q_84" }
    ]);
    expect(prisma.uploadAssetRendition.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.arrayContaining([
        expect.objectContaining({ kind: UploadRenditionKind.DETAIL, bytes: null }),
        expect.objectContaining({ kind: UploadRenditionKind.ZOOM, bytes: null }),
        expect.objectContaining({ kind: UploadRenditionKind.JPEG_FALLBACK, bytes: null })
      ])
    }));
    const body = result.body as {
      asset: {
        renditions: Record<string, { bytes: number | null; secureUrl: string }>;
      };
    };
    expect(body.asset.renditions.card.bytes).toBeNull();
    expect(body.asset.renditions.card.secureUrl).toContain("c_limit,w_640,h_640,f_webp,q_84");
    expect(result.serverTiming).toContain("cloudinary-upload");
    expect(result.serverTiming).toContain("rate-limit");
    expect(result.serverTiming).toContain("store-access");
    expect(result.serverTiming).toContain("idempotency-complete");
    expect(result.serverTiming).toContain("observability-audit");
    expect(result.serverTiming).toContain("total");

    await service.uploadImage({
      auth: {
        authzVersion: 1,
        isPlatformAdmin: false,
        permissions: [PERMISSIONS.PRODUCT_MANAGE],
        roleCodes: [],
        sessionId: "session-1",
        tokenFamilyId: "token-family-1",
        userId: "3f9d58cf-65e1-4a9b-bf87-a777d32af171"
      } as never,
      dto: {
        purpose: "PRODUCT_IMAGE",
        storeId: "1fc57307-2833-4a96-a7c6-810bcdc2d206",
        draftId: "draft-1",
        clientFileId: "6af99145-2977-4abd-8146-c7adc50fe8ef",
        idempotencyKey: "1974579e-ce20-4184-8ab9-0c389d26b92a",
        declaredMimeType: "image/jpeg"
      },
      file: {
        buffer,
        mimetype: "image/jpeg",
        originalname: "product-copy.jpg",
        size: buffer.length
      } as Express.Multer.File
    });

    expect(prisma.uploadAsset.findFirst).not.toHaveBeenCalled();
    expect(cloudinary.uploadOriginalImage).toHaveBeenCalledTimes(2);
  });
});
