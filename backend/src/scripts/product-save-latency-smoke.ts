import { StoreStatus, UploadAssetStatus, UploadPurpose, UploadRenditionKind } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { requestTimer } from "../common/request-timing";
import { PrismaService } from "../database/prisma.service";
import { InventoryService } from "../modules/inventory/inventory.service";
import { ProductsService } from "../modules/products/products.service";
import { PERMISSIONS } from "../modules/rbac/permissions";

const ITERATIONS = Number(process.env.PRODUCT_SAVE_SMOKE_ITERATIONS ?? 20);
const WARMUP_ITERATIONS = Number(process.env.PRODUCT_SAVE_SMOKE_WARMUP_ITERATIONS ?? 3);
const TARGET_MS = Number(process.env.PRODUCT_SAVE_SMOKE_TARGET_MS ?? 300);

async function main() {
  const prisma = new PrismaService();
  await prisma.$connect();
  const productIds: string[] = [];
  const uploadAssetIds: string[] = [];

  try {
    const store = await prisma.store.findFirst({
      where: {
        deletedAt: null,
        status: { in: [StoreStatus.APPROVED, StoreStatus.PENDING] }
      },
      select: { id: true, createdByUserId: true }
    });
    if (!store) {
      throw new Error("No APPROVED/PENDING store found. Seed a merchant store before running the smoke test.");
    }

    const inventory = new InventoryService(
      prisma,
      { isConfigured: false } as never,
      { invalidateStockSensitiveCaches: async () => undefined } as never
    );
    const service = new ProductsService(
      prisma,
      inventory,
      {
        storeAuthorization: async () => ({ permissions: [PERMISSIONS.PRODUCT_MANAGE] }),
        hasPermissions: () => true
      } as never,
      { invalidateShopCaches: async () => undefined } as never,
      { sweepStoreOrphans: async () => undefined } as never
    );

    const samples: Array<{ totalMs: number; serverTiming: string }> = [];
    const totalIterations = ITERATIONS + WARMUP_ITERATIONS;
    for (let index = 0; index < totalIterations; index += 1) {
      const assets = await Promise.all([
        seedReadyAsset(prisma, store.id, store.createdByUserId, index, 0),
        seedReadyAsset(prisma, store.id, store.createdByUserId, index, 1)
      ]);
      uploadAssetIds.push(...assets.map((asset) => asset.id));

      const request = {} as never;
      const timer = requestTimer(request);
      const startedAt = Date.now();
      const response = await service.create(
        {
          userId: store.createdByUserId,
          sessionId: "smoke-session",
          tokenFamilyId: "smoke-family",
          roleCodes: [],
          permissions: [PERMISSIONS.PRODUCT_MANAGE],
          isPlatformAdmin: false,
          authzVersion: 1,
          user: {
            id: store.createdByUserId,
            email: "smoke@example.test",
            fullName: null,
            avatarUrl: null,
            status: "ACTIVE",
            emailVerified: true,
            authzVersion: 1
          }
        } as never,
        {
          storeId: store.id,
          name: `Smoke Product ${Date.now()} ${index}`,
          category: "Grocery",
          subCategory: "Spices & Masala",
          productType: "Chilli Powder",
          price: 40,
          stock: 20,
          reorderPoint: 10,
          measurement: { unitGroup: "WEIGHT", quantityValue: 100, quantityUnit: "G", packType: "PACK" },
          status: "Published",
          seoDescription: "Smoke product latency test",
          images: assets.map((asset, assetIndex) => ({
            uploadAssetId: asset.id,
            sortOrder: assetIndex,
            isPrimary: assetIndex === 0,
            altText: `Smoke ${assetIndex + 1}`
          })),
          variants: [
            {
              clientId: "base-product",
              name: "100g",
              price: 40,
              stock: 10,
              measurement: { unitGroup: "WEIGHT", quantityValue: 100, quantityUnit: "G", packType: "PACK" }
            },
            {
              clientId: "small",
              name: "50g",
              price: 20,
              stock: 10,
              measurement: { unitGroup: "WEIGHT", quantityValue: 50, quantityUnit: "G", packType: "PACK" }
            }
          ]
        },
        timer
      );
      productIds.push(response.product.id);
      const totalMs = timer.finishTotal() || Date.now() - startedAt;
      if (index >= WARMUP_ITERATIONS) {
        samples.push({ totalMs, serverTiming: timer.serverTiming() });
      }
    }

    const totals = samples.map((sample) => sample.totalMs).sort((a, b) => a - b);
    const summary = {
      iterations: ITERATIONS,
      warmupIterations: WARMUP_ITERATIONS,
      targetMs: TARGET_MS,
      p50Ms: percentile(totals, 0.5),
      p95Ms: percentile(totals, 0.95),
      minMs: totals[0] ?? 0,
      maxMs: totals[totals.length - 1] ?? 0,
      slowestServerTiming: samples.sort((a, b) => b.totalMs - a.totalMs)[0]?.serverTiming ?? ""
    };
    console.log(JSON.stringify(summary, null, 2));
    if (summary.p95Ms > TARGET_MS) {
      process.exitCode = 1;
    }
  } finally {
    await cleanup(prisma, productIds, uploadAssetIds).catch((error) => {
      console.warn(`Smoke cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    });
    await prisma.$disconnect();
  }
}

async function seedReadyAsset(
  prisma: PrismaService,
  storeId: string,
  userId: string,
  iteration: number,
  index: number
) {
  const id = randomUUID();
  return prisma.uploadAsset.create({
    data: {
      id,
      storeId,
      uploadedByUserId: userId,
      purpose: UploadPurpose.PRODUCT_IMAGE,
      status: UploadAssetStatus.READY,
      sourceSha256: createHash("sha256").update(`${id}:${iteration}:${index}`).digest("hex"),
      originalFilename: `smoke-${iteration}-${index}.jpg`,
      draftId: `product-save-smoke-${iteration}`,
      clientFileId: `smoke-${iteration}-${index}`,
      mimeType: "image/jpeg",
      width: 640,
      height: 640,
      bytes: 10_240,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      renditions: {
        create: {
          kind: UploadRenditionKind.CARD,
          secureUrl: `https://cdn.example.test/${id}/card.webp`,
          transformation: "c_limit,w_640,h_640,f_webp,q_84",
          format: "webp",
          width: 640,
          height: 640,
          bytes: null
        }
      }
    },
    select: { id: true }
  });
}

async function cleanup(prisma: PrismaService, productIds: string[], uploadAssetIds: string[]) {
  if (productIds.length) {
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  }
  if (uploadAssetIds.length) {
    await prisma.uploadAsset.deleteMany({ where: { id: { in: uploadAssetIds } } });
  }
}

function percentile(sorted: number[], ratio: number) {
  if (!sorted.length) {
    return 0;
  }
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1);
  return sorted[index];
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
