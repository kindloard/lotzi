import { ForbiddenException, Injectable } from "@nestjs/common";
import { StoreStatus } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { AuthenticatedPrincipal } from "../auth/auth.types";
import { MerchantDashboardBootstrap } from "./merchant-dashboard.types";

interface DashboardBootstrapRow {
  user_id: string;
  user_email: string;
  full_name: string | null;
  avatar_url: string | null;
  store_id: string;
  store_name: string;
  store_slug: string;
  store_status: StoreStatus;
  store_image_url: string | null;
  business_name: string | null;
  logo_url: string | null;
  role_code: string;
  role_name: string;
}

@Injectable()
export class MerchantDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async bootstrap(auth: AuthenticatedPrincipal): Promise<MerchantDashboardBootstrap> {
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
}

function displayName(fullName: string | null, email: string) {
  const trimmed = fullName?.trim();
  if (trimmed) {
    return trimmed;
  }
  return email.split("@")[0] || "Merchant";
}
