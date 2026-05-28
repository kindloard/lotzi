import { ForbiddenException, Injectable, Logger } from "@nestjs/common";
import { Prisma, StoreStatus } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { RedisService } from "../redis/redis.service";
import { AuthenticatedPrincipal } from "../auth/auth.types";
import { UpdateStoreLocationDto } from "./dto/merchant-settings.dto";
import { MerchantDashboardBootstrap, MerchantStoreLocation } from "./merchant-dashboard.types";

const PUBLIC_SHOP_CACHE_KEYS = ["shops:list:v1", "shops:products:v1"];

interface DashboardBootstrapRow {
  user_id: string;
  user_email: string;
  full_name: string | null;
  avatar_url: string | null;
  store_id: string;
  store_name: string;
  store_slug: string;
  store_status: StoreStatus;
  store_address_line: string | null;
  store_city: string | null;
  store_state: string | null;
  store_pincode: string | null;
  store_latitude: Prisma.Decimal | number | string | null;
  store_longitude: Prisma.Decimal | number | string | null;
  store_updated_at: Date;
  store_image_url: string | null;
  business_name: string | null;
  logo_url: string | null;
  role_code: string;
  role_name: string;
}

@Injectable()
export class MerchantDashboardService {
  private readonly logger = new Logger(MerchantDashboardService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService
  ) {}

  async bootstrap(auth: AuthenticatedPrincipal): Promise<MerchantDashboardBootstrap> {
    const membership = await this.activeMembership(auth);

    return {
      user: {
        id: membership.user_id,
        name: displayName(membership.full_name, membership.user_email),
        email: membership.user_email,
        avatarUrl: membership.avatar_url
      },
      store: {
        id: membership.store_id,
        name: membership.business_name?.trim() || membership.store_name,
        slug: membership.store_slug,
        status: membership.store_status,
        logoUrl: membership.logo_url ?? membership.store_image_url ?? null
      },
      membership: {
        roleCode: membership.role_code,
        roleName: membership.role_name
      }
    };
  }

  async getStoreLocation(auth: AuthenticatedPrincipal): Promise<MerchantStoreLocation> {
    const membership = await this.activeMembership(auth);
    return locationFromMembership(membership);
  }

  async updateStoreLocation(
    auth: AuthenticatedPrincipal,
    dto: UpdateStoreLocationDto
  ): Promise<MerchantStoreLocation> {
    const membership = await this.activeMembership(auth);
    const updated = await this.prisma.store.update({
      where: { id: membership.store_id },
      data: {
        latitude: roundCoordinate(dto.latitude),
        longitude: roundCoordinate(dto.longitude),
        ...(dto.addressLine === undefined ? {} : { addressLine: nullableText(dto.addressLine) }),
        ...(dto.city === undefined ? {} : { city: nullableText(dto.city) }),
        ...(dto.state === undefined ? {} : { state: nullableText(dto.state) }),
        ...(dto.pincode === undefined ? {} : { pincode: nullableText(dto.pincode) })
      },
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        addressLine: true,
        city: true,
        state: true,
        pincode: true,
        latitude: true,
        longitude: true,
        updatedAt: true
      }
    });

    await this.invalidatePublicShopCaches();
    return locationFromStore(updated);
  }

  private async activeMembership(auth: AuthenticatedPrincipal): Promise<DashboardBootstrapRow> {
    const rows = await this.prisma.$queryRaw<DashboardBootstrapRow[]>`
      SELECT
        u.id AS user_id,
        u.email AS user_email,
        u.full_name,
        u.avatar_url,
        s.id AS store_id,
        s.name AS store_name,
        s.slug AS store_slug,
        s.status AS store_status,
        s.address_line AS store_address_line,
        s.city AS store_city,
        s.state AS store_state,
        s.pincode AS store_pincode,
        s.latitude AS store_latitude,
        s.longitude AS store_longitude,
        s.updated_at AS store_updated_at,
        s.image_url AS store_image_url,
        bp.business_name,
        logo.url AS logo_url,
        r.code AS role_code,
        r.name AS role_name
      FROM store_members sm
      JOIN users u ON u.id = sm.user_id
      JOIN roles r ON r.id = sm.role_id
      JOIN stores s ON s.id = sm.store_id
      LEFT JOIN store_business_profiles bp ON bp.store_id = s.id
      LEFT JOIN store_branding branding ON branding.store_id = s.id
      LEFT JOIN store_media logo ON logo.id = branding.logo_media_id
      WHERE sm.user_id = ${auth.userId}::uuid
        AND sm.status = 'ACTIVE'
        AND s.deleted_at IS NULL
        AND s.status IN ('PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED')
      ORDER BY
        CASE
          WHEN s.status = 'APPROVED' THEN 0
          WHEN s.status = 'PENDING' THEN 1
          ELSE 2
        END,
        s.created_at DESC,
        sm.joined_at DESC NULLS LAST,
        sm.created_at DESC
      LIMIT 1
    `;
    const membership = rows[0];

    if (!membership) {
      throw new ForbiddenException({
        code: "MERCHANT_STORE_REQUIRED",
        message: "No active merchant store is available for this account."
      });
    }

    return membership;
  }

  private async invalidatePublicShopCaches() {
    try {
      await Promise.all(PUBLIC_SHOP_CACHE_KEYS.map((key) => this.redis.del(key)));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Store location saved, but public shop cache invalidation failed: ${message}`);
    }
  }
}

function displayName(fullName: string | null, email: string) {
  const trimmed = fullName?.trim();
  if (trimmed) {
    return trimmed;
  }
  return email.split("@")[0] || "Merchant";
}

function locationFromMembership(membership: DashboardBootstrapRow): MerchantStoreLocation {
  return {
    id: membership.store_id,
    name: membership.business_name?.trim() || membership.store_name,
    slug: membership.store_slug,
    status: membership.store_status,
    addressLine: membership.store_address_line,
    city: membership.store_city,
    state: membership.store_state,
    pincode: membership.store_pincode,
    latitude: decimalToNumber(membership.store_latitude),
    longitude: decimalToNumber(membership.store_longitude),
    googleMapsUrl: googleMapsUrl(membership.store_latitude, membership.store_longitude),
    updatedAt: membership.store_updated_at.toISOString()
  };
}

function locationFromStore(store: {
  id: string;
  name: string;
  slug: string;
  status: StoreStatus;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  latitude: Prisma.Decimal | number | string | null;
  longitude: Prisma.Decimal | number | string | null;
  updatedAt: Date;
}): MerchantStoreLocation {
  return {
    id: store.id,
    name: store.name,
    slug: store.slug,
    status: store.status,
    addressLine: store.addressLine,
    city: store.city,
    state: store.state,
    pincode: store.pincode,
    latitude: decimalToNumber(store.latitude),
    longitude: decimalToNumber(store.longitude),
    googleMapsUrl: googleMapsUrl(store.latitude, store.longitude),
    updatedAt: store.updatedAt.toISOString()
  };
}

function nullableText(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function roundCoordinate(value: number) {
  return Math.round(value * 10_000_000) / 10_000_000;
}

function decimalToNumber(value: Prisma.Decimal | number | string | null | undefined) {
  if (value == null) {
    return null;
  }
  const parsed = typeof value === "number" ? value : Number(value.toString());
  return Number.isFinite(parsed) ? parsed : null;
}

function googleMapsUrl(
  latitude: Prisma.Decimal | number | string | null | undefined,
  longitude: Prisma.Decimal | number | string | null | undefined
) {
  const lat = decimalToNumber(latitude);
  const lng = decimalToNumber(longitude);
  if (lat == null || lng == null) {
    return null;
  }
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}
