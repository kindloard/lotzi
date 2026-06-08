import { BadRequestException, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { GEO_CURSOR_TTL_MS, type GeoGrid } from "./geo-utils";

interface CursorPayload {
  v: 1;
  kid: string;
  latGrid: string;
  lngGrid: string;
  radiusKm: number;
  distanceMeters: number;
  id: string;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
  originKey?: string | null;
  sessionHash: string | null;
}

export interface VerifiedGeoCursor {
  distanceMeters: number;
  id: string;
}

@Injectable()
export class GeoCursorService {
  private readonly activeKid: string;
  private readonly activeSecret: string;
  private readonly previousKid?: string;
  private readonly previousSecret?: string;

  constructor(config: ConfigService) {
    this.activeKid = config.get<string>("GEO_CURSOR_KEY_ID", "local-dev");
    this.activeSecret = config.get<string>(
      "GEO_CURSOR_SIGNING_KEY",
      "local-dev-geo-cursor-signing-key-change-before-prod"
    );
    this.previousKid = config.get<string>("GEO_CURSOR_PREVIOUS_KEY_ID");
    this.previousSecret = config.get<string>("GEO_CURSOR_PREVIOUS_SIGNING_KEY");
  }

  sign(input: {
    grid: GeoGrid;
    radiusKm: number;
    distanceMeters: number;
    id: string;
    originKey?: string | null;
    sessionHash?: string | null;
  }): string {
    const issuedAt = Date.now();
    const payload: CursorPayload = {
      v: 1,
      kid: this.activeKid,
      latGrid: input.grid.latGrid,
      lngGrid: input.grid.lngGrid,
      radiusKm: input.radiusKm,
      distanceMeters: Math.max(0, Math.round(input.distanceMeters)),
      id: input.id,
      issuedAt,
      expiresAt: issuedAt + GEO_CURSOR_TTL_MS,
      nonce: randomUUID(),
      originKey: input.originKey ?? null,
      sessionHash: input.sessionHash ?? null
    };
    const encoded = encode(JSON.stringify(payload));
    return `${encoded}.${this.signature(encoded, this.activeSecret)}`;
  }

  verify(
    cursor: string,
    context: { grid: GeoGrid; originKey?: string | null; radiusKm: number; sessionHash?: string | null }
  ): VerifiedGeoCursor {
    const [encoded, signature] = cursor.split(".");
    if (!encoded || !signature || cursor.split(".").length !== 2) {
      throw invalidCursor();
    }

    let payload: CursorPayload;
    try {
      payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as CursorPayload;
    } catch {
      throw invalidCursor();
    }

    const secret = this.secretForKid(payload.kid);
    if (!secret || !this.safeEqual(signature, this.signature(encoded, secret))) {
      throw invalidCursor();
    }
    if (
      payload.v !== 1 ||
      payload.expiresAt < Date.now() ||
      payload.latGrid !== context.grid.latGrid ||
      payload.lngGrid !== context.grid.lngGrid ||
      payload.radiusKm !== context.radiusKm ||
      (payload.originKey ?? null) !== (context.originKey ?? null) ||
      (payload.sessionHash && context.sessionHash && payload.sessionHash !== context.sessionHash) ||
      !isUuid(payload.id) ||
      !Number.isFinite(payload.distanceMeters)
    ) {
      throw invalidCursor();
    }

    return {
      distanceMeters: payload.distanceMeters,
      id: payload.id
    };
  }

  private secretForKid(kid: string): string | null {
    if (kid === this.activeKid) {
      return this.activeSecret;
    }
    if (this.previousKid && kid === this.previousKid && this.previousSecret) {
      return this.previousSecret;
    }
    return null;
  }

  private signature(encodedPayload: string, secret: string): string {
    return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
  }

  private safeEqual(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left, "base64url");
    const rightBuffer = Buffer.from(right, "base64url");
    return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
  }
}

function encode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function invalidCursor(): BadRequestException {
  return new BadRequestException({
    apiVersion: "v1",
    code: "INVALID_CURSOR",
    message: "cursor is invalid or expired."
  });
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
