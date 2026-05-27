import { ConflictException } from "@nestjs/common";
import { IdempotencyService } from "@/modules/uploads/idempotency.service";

const baseInput = {
  key: "upload:v1:40754379-ea32-44df-9026-b9571d7c7871:80f86523226a62f0613cacc0b33768c2109b00bfbbe7e5453160758d115726ed",
  storeId: "1fc57307-2833-4a96-a7c6-810bcdc2d206",
  userId: "3f9d58cf-65e1-4a9b-bf87-a777d32af171",
  operation: "upload.image.v1",
  requestHash: "80f86523226a62f0613cacc0b33768c2109b00bfbbe7e5453160758d115726ed"
};

describe("IdempotencyService Redis hot path", () => {
  it("reserves new upload keys in Redis with a 60 second lease", async () => {
    const redis = redisMock({ setNxEx: jest.fn().mockResolvedValue(true) });
    const service = new IdempotencyService(prismaMock() as never, redis as never);

    const reservation = await service.reserve(baseInput);

    expect(redis.setNxEx).toHaveBeenCalledWith(
      `idempotency:${baseInput.key}`,
      60,
      expect.stringContaining("\"IN_PROGRESS\"")
    );
    expect(reservation).toMatchObject({ state: "reserved", backend: "redis" });
  });

  it("replays completed Redis responses without touching the database", async () => {
    const response = { apiVersion: "v1", asset: { id: "asset-1" } };
    const redis = redisMock({
      setNxEx: jest.fn().mockResolvedValue(false),
      get: jest.fn().mockResolvedValue(JSON.stringify({
        status: "COMPLETED",
        requestHash: baseInput.requestHash,
        userId: baseInput.userId,
        storeId: baseInput.storeId,
        operation: baseInput.operation,
        response
      }))
    });
    const prisma = prismaMock();
    const service = new IdempotencyService(prisma as never, redis as never);

    await expect(service.reserve(baseInput)).resolves.toEqual({ state: "replayed", response });
    expect(prisma.idempotencyKey.create).not.toHaveBeenCalled();
  });

  it("rejects Redis key reuse with a different request hash", async () => {
    const redis = redisMock({
      setNxEx: jest.fn().mockResolvedValue(false),
      get: jest.fn().mockResolvedValue(JSON.stringify({
        status: "IN_PROGRESS",
        requestHash: "different",
        reservationId: "reservation-1",
        userId: baseInput.userId,
        storeId: baseInput.storeId,
        operation: baseInput.operation
      }))
    });
    const service = new IdempotencyService(prismaMock() as never, redis as never);

    await expect(service.reserve(baseInput)).rejects.toBeInstanceOf(ConflictException);
  });

  it("uses compare-and-set completion and persists the result asynchronously", async () => {
    const redis = redisMock({ eval: jest.fn().mockResolvedValue(1) });
    const prisma = prismaMock();
    const service = new IdempotencyService(prisma as never, redis as never);
    const reservation = {
      state: "reserved" as const,
      backend: "redis" as const,
      reservationId: "reservation-1",
      ...baseInput
    };

    await service.complete(reservation, { ok: true });
    await Promise.resolve();

    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("reservationId"),
      [`idempotency:${baseInput.key}`],
      ["reservation-1", expect.stringContaining("\"COMPLETED\""), 600]
    );
    expect(prisma.idempotencyKey.upsert).toHaveBeenCalled();
  });

  it("deletes failed Redis reservations so users can retry immediately", async () => {
    const redis = redisMock({ eval: jest.fn().mockResolvedValue(1) });
    const service = new IdempotencyService(prismaMock() as never, redis as never);

    await service.fail({
      state: "reserved",
      backend: "redis",
      reservationId: "reservation-1",
      ...baseInput
    });

    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("DEL"),
      [`idempotency:${baseInput.key}`],
      ["reservation-1"]
    );
  });

  it("falls back to the Prisma implementation when Redis is unavailable", async () => {
    const redis = redisMock({ setNxEx: jest.fn().mockResolvedValue(null) });
    const prisma = prismaMock();
    prisma.idempotencyKey.create.mockResolvedValue({});
    const service = new IdempotencyService(prisma as never, redis as never);

    const reservation = await service.reserve(baseInput);

    expect(reservation).toMatchObject({ state: "reserved", backend: "database" });
    expect(prisma.idempotencyKey.create).toHaveBeenCalled();
  });
});

function redisMock(overrides: Record<string, jest.Mock> = {}) {
  return {
    setNxEx: jest.fn(),
    get: jest.fn(),
    eval: jest.fn(),
    ...overrides
  };
}

function prismaMock() {
  return {
    idempotencyKey: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn().mockResolvedValue({})
    }
  };
}
