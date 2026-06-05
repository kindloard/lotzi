import { BadRequestException } from "@nestjs/common";
import { GeoCursorService } from "../../modules/geo-discovery/geo-cursor.service";

const config = {
  get: jest.fn((key: string, fallback?: unknown) => {
    const values: Record<string, unknown> = {
      GEO_CURSOR_KEY_ID: "k1",
      GEO_CURSOR_SIGNING_KEY: "test-geo-cursor-signing-key-with-32-plus-chars"
    };
    return values[key] ?? fallback;
  })
};

describe("GeoCursorService", () => {
  it("signs and verifies a cursor bound to grid and radius", () => {
    const service = new GeoCursorService(config as never);
    const cursor = service.sign({
      grid: { latGrid: "12.912", lngGrid: "80.123" },
      radiusKm: 5,
      distanceMeters: 1234.4,
      id: "11111111-1111-4111-8111-111111111111",
      sessionHash: "session-a"
    });

    expect(service.verify(cursor, {
      grid: { latGrid: "12.912", lngGrid: "80.123" },
      radiusKm: 5,
      sessionHash: "session-a"
    })).toEqual({
      distanceMeters: 1234,
      id: "11111111-1111-4111-8111-111111111111"
    });
  });

  it("rejects replay across a different grid", () => {
    const service = new GeoCursorService(config as never);
    const cursor = service.sign({
      grid: { latGrid: "12.912", lngGrid: "80.123" },
      radiusKm: 5,
      distanceMeters: 100,
      id: "11111111-1111-4111-8111-111111111111"
    });

    expect(() => service.verify(cursor, {
      grid: { latGrid: "12.913", lngGrid: "80.123" },
      radiusKm: 5
    })).toThrow(BadRequestException);
  });

  it("allows public cell cursors when no per-request session hash is embedded", () => {
    const service = new GeoCursorService(config as never);
    const cursor = service.sign({
      grid: { latGrid: "12.912", lngGrid: "80.123" },
      radiusKm: 5,
      distanceMeters: 100,
      id: "11111111-1111-4111-8111-111111111111",
      sessionHash: null
    });

    expect(service.verify(cursor, {
      grid: { latGrid: "12.912", lngGrid: "80.123" },
      radiusKm: 5,
      sessionHash: "different-request"
    })).toEqual({
      distanceMeters: 100,
      id: "11111111-1111-4111-8111-111111111111"
    });
  });
});
