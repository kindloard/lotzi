import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException
} from "@nestjs/common";
import {
  AuditOutcome,
  OtpPurpose,
  Prisma,
  SessionRevokedReason,
  UploadAssetStatus,
  UploadProvider,
  UploadPurpose,
  UploadRenditionKind,
  UserStatus
} from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { Response } from "express";
import { CloudinaryMediaProvider } from "../../integrations/cloudinary/cloudinary-media.provider";
import { PrismaService } from "../../database/prisma.service";
import { CryptoService } from "../../security/crypto.service";
import { OtpService } from "../../security/otp.service";
import { PasswordService } from "../../security/password.service";
import { TokenService } from "../../security/token.service";
import { AuditService } from "../audit/audit.service";
import { AuthenticatedPrincipal, RequestContext } from "../auth/auth.types";
import { MailService } from "../mail/mail.service";
import { RateLimitService } from "../rate-limit/rate-limit.service";
import { AuthStateInvalidator } from "../rbac/auth-state-invalidator.service";
import {
  ChangePasswordDto,
  ConfirmEmailChangeDto,
  CreateAddressDto,
  DeleteAccountDto,
  RequestEmailChangeDto,
  UpdateAddressDto,
  UpdateProfileDto
} from "./dto/customer-account.dto";
import sharp = require("sharp");

const EMAIL_CHANGE_TTL_MINUTES = 10;
const DELETE_ACCOUNT_TTL_MINUTES = 10;
const OTP_RESEND_COOLDOWN_SECONDS = 60;
const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
const AVATAR_MAX_PIXELS = 16_000_000;
const VISIBLE_ACTIVITY_TYPES = new Map<string, { category: string; summary: string }>([
  ["account.profile.updated", { category: "profile", summary: "Profile details updated" }],
  ["account.avatar.updated", { category: "profile", summary: "Profile photo updated" }],
  ["account.address.created", { category: "address", summary: "Delivery address added" }],
  ["account.address.updated", { category: "address", summary: "Delivery address updated" }],
  ["account.address.deleted", { category: "address", summary: "Delivery address deleted" }],
  ["account.address.default_set", { category: "address", summary: "Default delivery address changed" }],
  ["account.email_change.requested", { category: "security", summary: "Email change requested" }],
  ["account.email_change.completed", { category: "security", summary: "Email address changed" }],
  ["account.password.changed", { category: "security", summary: "Password changed" }],
  ["account.session.revoked", { category: "security", summary: "Session revoked" }],
  ["account.sessions.revoked_other", { category: "security", summary: "Other sessions signed out" }],
  ["account.deletion.requested", { category: "security", summary: "Account deletion requested" }],
  ["account.deletion.completed", { category: "security", summary: "Account deleted" }]
]);
type CheckoutAddressHint = { id: string };

@Injectable()
export class CustomerAccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rateLimit: RateLimitService,
    private readonly password: PasswordService,
    private readonly otp: OtpService,
    private readonly crypto: CryptoService,
    private readonly tokens: TokenService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly authStateInvalidator: AuthStateInvalidator,
    private readonly cloudinary: CloudinaryMediaProvider
  ) {}

  async bootstrap(auth: AuthenticatedPrincipal) {
    const [user, addressCount, activeSessionCount, orderCount, activityCount] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: auth.userId },
        select: {
          id: true,
          email: true,
          fullName: true,
          avatarUrl: true,
          emailVerified: true,
          updatedAt: true
        }
      }),
      this.prisma.address.count({ where: { userId: auth.userId, deletedAt: null } }),
      this.prisma.session.count({
        where: { userId: auth.userId, revoked: false, expiresAt: { gt: new Date() } }
      }),
      this.prisma.order.count({ where: { userId: auth.userId } }),
      this.prisma.auditLog.count({
        where: {
          actorUserId: auth.userId,
          eventType: { in: Array.from(VISIBLE_ACTIVITY_TYPES.keys()) }
        }
      })
    ]);

    return {
      apiVersion: "v1",
      account: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        avatarUrl: user.avatarUrl,
        emailVerified: user.emailVerified,
        profileVersion: user.updatedAt.toISOString()
      },
      sections: [
        "profile",
        "addresses",
        "orders",
        "wishlist",
        "payments",
        "settings",
        "security",
        "recent",
        "recommendations"
      ],
      summary: {
        addresses: addressCount,
        orders: orderCount,
        activeSessions: activeSessionCount,
        activity: activityCount
      },
      cache: {
        generatedAt: new Date().toISOString(),
        maxAgeSeconds: 60
      }
    };
  }

  async profile(auth: AuthenticatedPrincipal) {
    return {
      apiVersion: "v1",
      profile: await this.safeProfile(auth.userId)
    };
  }

  async updateProfile(auth: AuthenticatedPrincipal, dto: UpdateProfileDto, context: RequestContext) {
    await this.rateLimit.enforce(`account:profile:update:${auth.userId}`, 20, 5 * 60);
    const current = await this.profileRow(auth.userId);
    this.assertProfileVersion(current.updatedAt, dto.profileVersion, current);

    const fullName = cleanOptional(dto.fullName);
    const phone = dto.phone === null ? null : cleanOptional(dto.phone);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: auth.userId },
        data: {
          ...(fullName !== undefined ? { fullName } : {}),
          ...(phone !== undefined ? { phone } : {}),
          updatedAt: now
        }
      });
      await tx.customerProfile.upsert({
        where: { userId: auth.userId },
        update: {
          ...(fullName !== undefined ? { displayName: fullName } : {}),
          ...(phone !== undefined ? { phone } : {}),
          ...(dto.marketingOptIn !== undefined ? { marketingOptIn: dto.marketingOptIn } : {})
        },
        create: {
          userId: auth.userId,
          displayName: fullName ?? current.fullName,
          phone: phone ?? current.phone,
          marketingOptIn: dto.marketingOptIn ?? false
        }
      });
    });

    // Fire-and-forget: cache invalidation must never block the HTTP response.
    void this.invalidateUserCaches(auth.userId, auth.authzVersion);

    this.audit.record({
      eventType: "account.profile.updated",
      actorUserId: auth.userId,
      outcome: AuditOutcome.SUCCESS,
      ip: context.ip,
      requestId: context.requestId,
      sessionId: auth.sessionId
    });

    // Build response from in-memory data — avoids an extra Supabase round-trip.
    const updatedProfile = mapProfile({
      ...current,
      fullName: fullName !== undefined ? (fullName ?? null) : current.fullName,
      phone: phone !== undefined ? (phone ?? null) : current.phone,
      updatedAt: now,
      customerProfile: {
        displayName: fullName !== undefined ? (fullName ?? null) : (current.customerProfile?.displayName ?? null),
        phone: phone !== undefined ? (phone ?? null) : (current.customerProfile?.phone ?? null),
        marketingOptIn: dto.marketingOptIn !== undefined ? dto.marketingOptIn : (current.customerProfile?.marketingOptIn ?? false),
        loyaltyTier: current.customerProfile?.loyaltyTier ?? "STANDARD"
      }
    });
    return { apiVersion: "v1", profile: updatedProfile };
  }

  async uploadAvatar(
    auth: AuthenticatedPrincipal,
    file: Express.Multer.File | undefined,
    context: RequestContext
  ) {
    await this.rateLimit.enforce(`account:avatar:${auth.userId}`, 10, 60 * 60);
    if (!file?.buffer?.length) {
      throw new BadRequestException({ code: "AVATAR_FILE_MISSING", message: "Attach one image file." });
    }
    if (file.size > AVATAR_MAX_BYTES) {
      throw new BadRequestException({ code: "AVATAR_TOO_LARGE", message: "Profile image must be 5 MB or smaller." });
    }
    const magic = sniffImage(file.buffer);
    if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(magic.mimeType)) {
      throw new BadRequestException({ code: "AVATAR_UNSUPPORTED_FORMAT", message: "Use a JPG, PNG, WebP, or GIF image." });
    }

    const metadata = await sharp(file.buffer, { limitInputPixels: AVATAR_MAX_PIXELS, pages: 1 }).metadata().catch(() => null);
    if (!metadata?.width || !metadata.height) {
      throw new BadRequestException({ code: "AVATAR_CORRUPT_IMAGE", message: "Profile image could not be decoded." });
    }

    const processed = await sharp(file.buffer, { limitInputPixels: AVATAR_MAX_PIXELS, pages: 1 })
      .rotate()
      .resize(512, 512, { fit: "cover" })
      .webp({ quality: 86 })
      .toBuffer({ resolveWithObject: true });

    const assetId = randomUUID();
    const sourceSha256 = sha256(file.buffer);
    const publicId = `users/${auth.userId}/avatar/${assetId}`;
    const original = await this.cloudinary.uploadOriginalImage({
      buffer: processed.data,
      contentType: "image/webp",
      publicId,
      tags: ["lotzi", "user_avatar"],
      context: {
        userId: auth.userId,
        uploadAssetId: assetId,
        purpose: UploadPurpose.USER_AVATAR
      }
    });
    const renditions = avatarRenditions(original.publicId, original.version, this.cloudinary);
    const avatarUrl = renditions.card.secureUrl;

    await this.prisma.$transaction([
      this.prisma.uploadAsset.create({
        data: {
          id: assetId,
          uploadedByUserId: auth.userId,
          purpose: UploadPurpose.USER_AVATAR,
          status: UploadAssetStatus.ATTACHED,
          sourceSha256,
          originalFilename: sanitizeFilename(file.originalname),
          mimeType: "image/webp",
          width: processed.info.width,
          height: processed.info.height,
          bytes: processed.info.size,
          originalProviderPublicId: original.publicId,
          originalSecureUrl: original.secureUrl,
          attachedAt: new Date()
        }
      }),
      this.prisma.uploadAssetRendition.createMany({
        data: Object.values(renditions).map((rendition) => ({
          uploadAssetId: assetId,
          kind: rendition.kind,
          provider: UploadProvider.CLOUDINARY,
          providerPublicId: null,
          secureUrl: rendition.secureUrl,
          transformation: rendition.transformation,
          format: "webp",
          width: rendition.width,
          height: rendition.height,
          bytes: null
        }))
      }),
      this.prisma.user.update({
        where: { id: auth.userId },
        data: { avatarUrl, updatedAt: new Date() }
      })
    ]);

    await this.invalidateUserCaches(auth.userId, auth.authzVersion);
    this.audit.record({
      eventType: "account.avatar.updated",
      actorUserId: auth.userId,
      outcome: AuditOutcome.SUCCESS,
      ip: context.ip,
      requestId: context.requestId,
      sessionId: auth.sessionId,
      metadata: { uploadAssetId: assetId } as Prisma.InputJsonObject
    });

    return { apiVersion: "v1", profile: await this.safeProfile(auth.userId) };
  }

  async addresses(auth: AuthenticatedPrincipal) {
    const addresses = await this.prisma.address.findMany({
      where: { userId: auth.userId, deletedAt: null },
      orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }]
    });
    return { apiVersion: "v1", addresses: addresses.map(safeAddress) };
  }

  async checkoutAddress(auth: AuthenticatedPrincipal, selectedAddressId?: string) {
    const requestedAddressId = uuidOrUndefined(selectedAddressId);
    const address = await this.loadCheckoutAddress(auth.userId, requestedAddressId);
    return {
      apiVersion: "v1",
      address,
      cacheStatus: "HIT",
      revalidateAfterMs: null
    };
  }

  async createAddress(auth: AuthenticatedPrincipal, dto: CreateAddressDto, context: RequestContext) {
    await this.rateLimit.enforce(`account:address:write:${auth.userId}`, 30, 10 * 60);
    const created = await this.prisma.$transaction(async (tx) => {
      const existingCount = await tx.address.count({ where: { userId: auth.userId, deletedAt: null } });
      const makeDefault = dto.isDefault === true || existingCount === 0;
      if (makeDefault) {
        await tx.address.updateMany({
          where: { userId: auth.userId, deletedAt: null, isDefault: true },
          data: { isDefault: false, version: { increment: 1 } }
        });
      }
      return tx.address.create({
        data: {
          userId: auth.userId,
          ...addressData(dto),
          isDefault: makeDefault
        }
      });
    });
    this.audit.record({
      eventType: "account.address.created",
      actorUserId: auth.userId,
      outcome: AuditOutcome.SUCCESS,
      ip: context.ip,
      requestId: context.requestId,
      sessionId: auth.sessionId,
      metadata: { addressId: created.id } as Prisma.InputJsonObject
    });
    const address = safeAddress(created);
    return { apiVersion: "v1", address };
  }

  async updateAddress(auth: AuthenticatedPrincipal, id: string, dto: UpdateAddressDto, context: RequestContext) {
    await this.rateLimit.enforce(`account:address:write:${auth.userId}`, 30, 10 * 60);
    const current = await this.prisma.address.findFirst({
      where: { id, userId: auth.userId, deletedAt: null }
    });
    if (!current) {
      throw new NotFoundException("Address not found.");
    }
    if (current.version !== dto.addressVersion) {
      throw new ConflictException({
        code: "ADDRESS_VERSION_CONFLICT",
        message: "This address was changed in another tab. Refresh and try again.",
        details: { address: safeAddress(current) }
      });
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.isDefault === true) {
        await tx.address.updateMany({
          where: { userId: auth.userId, deletedAt: null, isDefault: true, id: { not: id } },
          data: { isDefault: false, version: { increment: 1 } }
        });
      }
      return tx.address.update({
        where: { id },
        data: {
          ...addressData(dto),
          ...(dto.isDefault !== undefined ? { isDefault: dto.isDefault } : {}),
          version: { increment: 1 }
        }
      });
    });
    this.audit.record({
      eventType: "account.address.updated",
      actorUserId: auth.userId,
      outcome: AuditOutcome.SUCCESS,
      ip: context.ip,
      requestId: context.requestId,
      sessionId: auth.sessionId,
      metadata: { addressId: id } as Prisma.InputJsonObject
    });
    const address = safeAddress(updated);
    return { apiVersion: "v1", address };
  }

  async deleteAddress(auth: AuthenticatedPrincipal, id: string, context: RequestContext) {
    await this.rateLimit.enforce(`account:address:write:${auth.userId}`, 30, 10 * 60);
    const current = await this.prisma.address.findFirst({
      where: { id, userId: auth.userId, deletedAt: null }
    });
    if (!current) {
      throw new NotFoundException("Address not found.");
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.address.update({
        where: { id },
        data: { deletedAt: new Date(), isDefault: false, version: { increment: 1 } }
      });
      if (current.isDefault) {
        const fallback = await tx.address.findFirst({
          where: { userId: auth.userId, deletedAt: null, id: { not: id } },
          orderBy: { updatedAt: "desc" },
          select: { id: true }
        });
        if (fallback) {
          await tx.address.update({
            where: { id: fallback.id },
            data: { isDefault: true, version: { increment: 1 } }
          });
        }
      }
    });
    this.audit.record({
      eventType: "account.address.deleted",
      actorUserId: auth.userId,
      outcome: AuditOutcome.SUCCESS,
      ip: context.ip,
      requestId: context.requestId,
      sessionId: auth.sessionId,
      metadata: { addressId: id } as Prisma.InputJsonObject
    });
    return { apiVersion: "v1", status: "DELETED" };
  }

  async setDefaultAddress(auth: AuthenticatedPrincipal, id: string, context: RequestContext) {
    await this.rateLimit.enforce(`account:address:write:${auth.userId}`, 30, 10 * 60);
    const exists = await this.prisma.address.findFirst({
      where: { id, userId: auth.userId, deletedAt: null },
      select: { id: true }
    });
    if (!exists) {
      throw new NotFoundException("Address not found.");
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.address.updateMany({
        where: { userId: auth.userId, deletedAt: null, isDefault: true, id: { not: id } },
        data: { isDefault: false, version: { increment: 1 } }
      });
      return tx.address.update({
        where: { id },
        data: { isDefault: true, version: { increment: 1 } }
      });
    });
    this.audit.record({
      eventType: "account.address.default_set",
      actorUserId: auth.userId,
      outcome: AuditOutcome.SUCCESS,
      ip: context.ip,
      requestId: context.requestId,
      sessionId: auth.sessionId,
      metadata: { addressId: id } as Prisma.InputJsonObject
    });
    const address = safeAddress(updated);
    return { apiVersion: "v1", address };
  }

  async orders(auth: AuthenticatedPrincipal, cursor?: string, limit = 10) {
    const safeLimit = Math.min(25, Math.max(1, limit));
    const orders = await this.prisma.order.findMany({
      where: { userId: auth.userId },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { createdAt: "desc" },
      take: safeLimit + 1,
      select: {
        id: true,
        status: true,
        paymentMethod: true,
        paymentStatus: true,
        subtotal: true,
        deliveryFee: true,
        total: true,
        customerNote: true,
        createdAt: true,
        updatedAt: true,
        addressRecipientName: true,
        addressRecipientPhone: true,
        addressLine1: true,
        addressLine2: true,
        addressCity: true,
        addressState: true,
        addressPincode: true,
        store: { select: { id: true, name: true, slug: true, imageUrl: true } },
        address: {
          select: {
            recipientName: true,
            recipientPhone: true,
            line1: true,
            line2: true,
            city: true,
            state: true,
            pincode: true
          }
        },
        payment: { select: { id: true, method: true, status: true, amount: true, createdAt: true } },
        items: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            productId: true,
            variantId: true,
            name: true,
            variantName: true,
            unitDisplay: true,
            quantity: true,
            unitPrice: true,
            mrp: true,
            total: true
          }
        }
      }
    });
    const page = orders.slice(0, safeLimit);
    return {
      apiVersion: "v1",
      orders: page.map(safeOrder),
      nextCursor: orders.length > safeLimit ? page[page.length - 1]?.id ?? null : null
    };
  }

  async sessions(auth: AuthenticatedPrincipal) {
    const sessions = await this.prisma.session.findMany({
      where: { userId: auth.userId, revoked: false, expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: "desc" },
      select: {
        id: true,
        userAgent: true,
        deviceMetadata: true,
        createdAt: true,
        lastSeenAt: true,
        expiresAt: true
      }
    });
    return {
      apiVersion: "v1",
      sessions: sessions.map((session) => safeSession(session, auth.sessionId))
    };
  }

  async revokeSession(auth: AuthenticatedPrincipal, id: string, context: RequestContext, response?: Response) {
    await this.rateLimit.enforce(`account:sessions:revoke:${auth.userId}`, 20, 10 * 60);
    const result = await this.prisma.session.updateMany({
      where: { id, userId: auth.userId, revoked: false },
      data: {
        revoked: true,
        revokedAt: new Date(),
        revokedReason: SessionRevokedReason.USER_REVOKED
      }
    });
    if (result.count === 0) {
      throw new NotFoundException("Session not found.");
    }
    await this.authStateInvalidator.invalidateSessions([id]);
    if (id === auth.sessionId && response) {
      this.tokens.clearAuthCookies(response);
    }
    this.audit.record({
      eventType: "account.session.revoked",
      actorUserId: auth.userId,
      outcome: AuditOutcome.SUCCESS,
      ip: context.ip,
      requestId: context.requestId,
      sessionId: auth.sessionId,
      metadata: { revokedSessionId: id, current: id === auth.sessionId } as Prisma.InputJsonObject
    });
    return { apiVersion: "v1", status: "REVOKED", currentSessionRevoked: id === auth.sessionId };
  }

  async revokeOtherSessions(auth: AuthenticatedPrincipal, context: RequestContext) {
    await this.rateLimit.enforce(`account:sessions:revoke:${auth.userId}`, 10, 10 * 60);
    const ids = await this.prisma.session.findMany({
      where: {
        userId: auth.userId,
        id: { not: auth.sessionId },
        revoked: false,
        expiresAt: { gt: new Date() }
      },
      select: { id: true }
    });
    await this.prisma.session.updateMany({
      where: { id: { in: ids.map((session) => session.id) } },
      data: {
        revoked: true,
        revokedAt: new Date(),
        revokedReason: SessionRevokedReason.USER_REVOKED
      }
    });
    await this.authStateInvalidator.invalidateSessions(ids.map((session) => session.id));
    this.audit.record({
      eventType: "account.sessions.revoked_other",
      actorUserId: auth.userId,
      outcome: AuditOutcome.SUCCESS,
      ip: context.ip,
      requestId: context.requestId,
      sessionId: auth.sessionId,
      metadata: { revokedCount: ids.length } as Prisma.InputJsonObject
    });
    return { apiVersion: "v1", status: "REVOKED", revokedCount: ids.length };
  }

  async changePassword(auth: AuthenticatedPrincipal, dto: ChangePasswordDto, context: RequestContext) {
    await this.rateLimit.enforce(`account:password:${auth.userId}`, 5, 60 * 60);
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: auth.userId },
      select: { id: true, email: true, passwordHash: true }
    });
    const valid = await this.password.verify(dto.currentPassword, user.passwordHash);
    if (!user.passwordHash || !valid) {
      throw new UnauthorizedException("Current password is incorrect.");
    }
    const passwordHash = await this.password.hash(dto.newPassword);
    const otherSessions = await this.prisma.session.findMany({
      where: { userId: auth.userId, id: { not: auth.sessionId }, revoked: false },
      select: { id: true }
    });
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: auth.userId },
        data: {
          passwordHash,
          passwordChangedAt: new Date(),
          failedAttempts: 0,
          lockedUntil: null
        }
      }),
      this.prisma.session.updateMany({
        where: { id: { in: otherSessions.map((session) => session.id) } },
        data: {
          revoked: true,
          revokedAt: new Date(),
          revokedReason: SessionRevokedReason.USER_REVOKED
        }
      })
    ]);
    await this.authStateInvalidator.invalidateSessions(otherSessions.map((session) => session.id));
    await this.mail.sendPasswordChangedNotice(user.email);
    this.audit.record({
      eventType: "account.password.changed",
      actorUserId: auth.userId,
      outcome: AuditOutcome.SUCCESS,
      ip: context.ip,
      requestId: context.requestId,
      sessionId: auth.sessionId,
      metadata: { revokedOtherSessions: otherSessions.length } as Prisma.InputJsonObject
    });
    return { apiVersion: "v1", status: "PASSWORD_CHANGED", revokedOtherSessions: otherSessions.length };
  }

  async requestEmailChange(auth: AuthenticatedPrincipal, dto: RequestEmailChangeDto, context: RequestContext) {
    await this.rateLimit.enforce(`account:email-change:${auth.userId}`, 5, 60 * 60);
    const newEmail = dto.newEmail.trim().toLowerCase();
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: auth.userId },
      select: { id: true, email: true, passwordHash: true }
    });
    const valid = await this.password.verify(dto.currentPassword, user.passwordHash);
    if (!user.passwordHash || !valid) {
      throw new UnauthorizedException("Current password is incorrect.");
    }
    const existing = await this.prisma.user.findFirst({
      where: { email: newEmail, id: { not: auth.userId }, status: { not: UserStatus.DELETED } },
      select: { id: true }
    });
    if (existing) {
      throw new ConflictException({ code: "EMAIL_ALREADY_REGISTERED", message: "That email is already registered." });
    }

    const latest = await this.prisma.otpVerification.findFirst({
      where: { userId: auth.userId, purpose: OtpPurpose.EMAIL_CHANGE, verified: false },
      orderBy: { createdAt: "desc" },
      select: { id: true, cooldownUntil: true }
    });
    if (latest?.cooldownUntil && latest.cooldownUntil > new Date()) {
      return {
        apiVersion: "v1",
        status: "OTP_REQUIRED",
        email: newEmail,
        cooldownUntil: latest.cooldownUntil.toISOString()
      };
    }

    const code = this.otp.generate();
    const nonce = this.otp.nonce();
    const otpHash = this.otp.hash(code, auth.userId, newEmail, nonce, OtpPurpose.EMAIL_CHANGE);
    const created = await this.prisma.otpVerification.create({
      data: {
        userId: auth.userId,
        email: newEmail,
        otpHash,
        otpNonce: nonce,
        purpose: OtpPurpose.EMAIL_CHANGE,
        metadata: { previousEmail: user.email },
        expiresAt: minutesFromNow(EMAIL_CHANGE_TTL_MINUTES),
        cooldownUntil: secondsFromNow(OTP_RESEND_COOLDOWN_SECONDS)
      }
    });
    await this.mail.sendEmailChangeOtp(newEmail, code, `email-change:${created.id}`);
    this.audit.record({
      eventType: "account.email_change.requested",
      actorUserId: auth.userId,
      outcome: AuditOutcome.PENDING,
      ip: context.ip,
      requestId: context.requestId,
      sessionId: auth.sessionId,
      metadata: { targetEmail: maskEmail(newEmail) } as Prisma.InputJsonObject
    });
    return {
      apiVersion: "v1",
      status: "OTP_REQUIRED",
      email: newEmail,
      cooldownUntil: created.cooldownUntil?.toISOString()
    };
  }

  async confirmEmailChange(auth: AuthenticatedPrincipal, dto: ConfirmEmailChangeDto, context: RequestContext) {
    await this.rateLimit.enforce(`account:email-change-confirm:${auth.userId}`, 10, 15 * 60);
    const newEmail = dto.newEmail.trim().toLowerCase();
    const otpRow = await this.prisma.otpVerification.findFirst({
      where: { userId: auth.userId, email: newEmail, purpose: OtpPurpose.EMAIL_CHANGE, verified: false },
      orderBy: { createdAt: "desc" },
      select: { id: true, otpNonce: true, otpHash: true, expiresAt: true, attemptCount: true }
    });
    const computed = otpRow
      ? this.otp.hash(dto.otp, auth.userId, newEmail, otpRow.otpNonce, OtpPurpose.EMAIL_CHANGE)
      : this.otp.hash(dto.otp, auth.userId, newEmail, this.otp.nonce(), OtpPurpose.EMAIL_CHANGE);
    if (!otpRow || otpRow.expiresAt <= new Date() || !this.crypto.timingSafeEqual(computed, otpRow.otpHash)) {
      if (otpRow) {
        await this.prisma.otpVerification.update({
          where: { id: otpRow.id },
          data: { attemptCount: { increment: 1 } }
        });
      }
      throw new UnauthorizedException("Invalid or expired verification code.");
    }
    const existing = await this.prisma.user.findFirst({
      where: { email: newEmail, id: { not: auth.userId }, status: { not: UserStatus.DELETED } },
      select: { id: true }
    });
    if (existing) {
      throw new ConflictException({ code: "EMAIL_ALREADY_REGISTERED", message: "That email is already registered." });
    }
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: auth.userId },
        data: {
          email: newEmail,
          emailVerified: true,
          updatedAt: new Date()
        }
      }),
      this.prisma.otpVerification.update({
        where: { id: otpRow.id },
        data: { verified: true, verifiedAt: new Date() }
      }),
      this.prisma.otpVerification.updateMany({
        where: {
          userId: auth.userId,
          purpose: OtpPurpose.EMAIL_CHANGE,
          verified: false,
          id: { not: otpRow.id }
        },
        data: { verified: true, verifiedAt: new Date() }
      })
    ]);
    await this.invalidateUserCaches(auth.userId, auth.authzVersion);
    this.audit.record({
      eventType: "account.email_change.completed",
      actorUserId: auth.userId,
      outcome: AuditOutcome.SUCCESS,
      ip: context.ip,
      requestId: context.requestId,
      sessionId: auth.sessionId,
      metadata: { targetEmail: maskEmail(newEmail) } as Prisma.InputJsonObject
    });
    return { apiVersion: "v1", profile: await this.safeProfile(auth.userId) };
  }

  async activity(auth: AuthenticatedPrincipal, limit = 30) {
    const safeLimit = Math.min(50, Math.max(1, limit));
    const rows = await this.prisma.auditLog.findMany({
      where: {
        actorUserId: auth.userId,
        eventType: { in: Array.from(VISIBLE_ACTIVITY_TYPES.keys()) }
      },
      orderBy: { createdAt: "desc" },
      take: safeLimit,
      select: {
        id: true,
        eventType: true,
        outcome: true,
        createdAt: true
      }
    });
    return {
      apiVersion: "v1",
      activity: rows.map((row) => {
        const copy = VISIBLE_ACTIVITY_TYPES.get(row.eventType)!;
        return {
          id: row.id,
          type: row.eventType,
          category: copy.category,
          summary: copy.summary,
          outcome: row.outcome,
          createdAt: row.createdAt.toISOString()
        };
      })
    };
  }

  async requestDeleteAccount(auth: AuthenticatedPrincipal, context: RequestContext) {
    await this.rateLimit.enforce(`account:delete-request:${auth.userId}`, 3, 60 * 60);
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: auth.userId },
      select: { email: true }
    });
    const latest = await this.prisma.accountDeletionRequest.findFirst({
      where: { userId: auth.userId, consumedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true, cooldownUntil: true }
    });
    if (latest?.cooldownUntil && latest.cooldownUntil > new Date()) {
      return {
        apiVersion: "v1",
        status: "OTP_REQUIRED",
        cooldownUntil: latest.cooldownUntil.toISOString()
      };
    }
    const code = this.otp.generate();
    const nonce = this.otp.nonce();
    const created = await this.prisma.accountDeletionRequest.create({
      data: {
        userId: auth.userId,
        confirmationHash: this.deleteConfirmationHash(auth.userId, user.email, nonce, code),
        confirmationNonce: nonce,
        requestedIp: context.ip,
        expiresAt: minutesFromNow(DELETE_ACCOUNT_TTL_MINUTES),
        cooldownUntil: secondsFromNow(OTP_RESEND_COOLDOWN_SECONDS)
      }
    });
    await this.mail.sendAccountDeletionOtp(user.email, code, `account-delete:${created.id}`);
    this.audit.record({
      eventType: "account.deletion.requested",
      actorUserId: auth.userId,
      outcome: AuditOutcome.PENDING,
      ip: context.ip,
      requestId: context.requestId,
      sessionId: auth.sessionId
    });
    return {
      apiVersion: "v1",
      status: "OTP_REQUIRED",
      cooldownUntil: created.cooldownUntil?.toISOString()
    };
  }

  async deleteAccount(auth: AuthenticatedPrincipal, dto: DeleteAccountDto, context: RequestContext, response: Response) {
    await this.rateLimit.enforce(`account:delete:${auth.userId}`, 3, 60 * 60);
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: auth.userId },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        authzVersion: true
      }
    });
    const deleteRequest = await this.prisma.accountDeletionRequest.findFirst({
      where: { userId: auth.userId, consumedAt: null },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        confirmationHash: true,
        confirmationNonce: true,
        expiresAt: true
      }
    });
    if (!deleteRequest || deleteRequest.expiresAt <= new Date()) {
      throw new UnauthorizedException("Request a new account deletion code before deleting your account.");
    }
    const passwordOk = dto.currentPassword
      ? await this.password.verify(dto.currentPassword, user.passwordHash)
      : false;
    const otpOk = dto.otp ? this.verifyDeleteOtp(auth.userId, user.email, dto.otp, deleteRequest) : false;
    if (!passwordOk && !otpOk) {
      throw new UnauthorizedException("Account deletion confirmation failed.");
    }
    const sessionIds = await this.prisma.session.findMany({
      where: { userId: auth.userId, revoked: false },
      select: { id: true }
    });
    const anonymizedEmail = `deleted-${auth.userId}@deleted.lotzi.local`;
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: auth.userId },
        data: {
          email: anonymizedEmail,
          fullName: null,
          phone: null,
          avatarUrl: null,
          passwordHash: null,
          status: UserStatus.DELETED,
          deletedAt: new Date(),
          authzVersion: { increment: 1 }
        }
      }),
      this.prisma.customerProfile.updateMany({
        where: { userId: auth.userId },
        data: { displayName: null, phone: null, marketingOptIn: false }
      }),
      this.prisma.identityProvider.deleteMany({ where: { userId: auth.userId } }),
      this.prisma.otpVerification.deleteMany({ where: { userId: auth.userId } }),
      this.prisma.passwordReset.deleteMany({ where: { userId: auth.userId } }),
      this.prisma.address.updateMany({
        where: { userId: auth.userId, deletedAt: null },
        data: { deletedAt: new Date(), isDefault: false, version: { increment: 1 } }
      }),
      this.prisma.session.updateMany({
        where: { userId: auth.userId, revoked: false },
        data: {
          revoked: true,
          revokedAt: new Date(),
          revokedReason: SessionRevokedReason.USER_REVOKED
        }
      }),
      this.prisma.accountDeletionRequest.updateMany({
        where: { userId: auth.userId, consumedAt: null },
        data: { consumedAt: new Date() }
      })
    ]);
    await Promise.all([
      this.authStateInvalidator.invalidateSessions(sessionIds.map((session) => session.id)),
      this.authStateInvalidator.invalidateUserVersions(auth.userId, [user.authzVersion, user.authzVersion + 1])
    ]);
    this.tokens.clearAuthCookies(response);
    this.audit.record({
      eventType: "account.deletion.completed",
      actorUserId: auth.userId,
      outcome: AuditOutcome.SUCCESS,
      ip: context.ip,
      requestId: context.requestId,
      sessionId: auth.sessionId
    });
    return { apiVersion: "v1", status: "DELETED" };
  }

  private async safeProfile(userId: string) {
    return mapProfile(await this.profileRow(userId));
  }

  async profileRow(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        fullName: true,
        avatarUrl: true,
        phone: true,
        emailVerified: true,
        providerType: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        customerProfile: {
          select: {
            displayName: true,
            phone: true,
            marketingOptIn: true,
            loyaltyTier: true
          }
        }
      }
    });
    if (user.status === UserStatus.DELETED) {
      throw new NotFoundException("Profile not found.");
    }
    return user;
  }

  private assertProfileVersion(
    currentVersion: Date,
    expectedVersion: string,
    current: Awaited<ReturnType<CustomerAccountService["profileRow"]>>
  ) {
    if (currentVersion.getTime() === new Date(expectedVersion).getTime()) {
      return;
    }
    throw new ConflictException({
      code: "PROFILE_VERSION_CONFLICT",
      message: "Your profile changed in another tab. Refresh and try again.",
      details: { profile: mapProfile(current) }
    });
  }

  private async invalidateUserCaches(userId: string, authzVersion: number) {
    try {
      const sessions = await this.prisma.session.findMany({
        where: { userId, revoked: false, expiresAt: { gt: new Date() } },
        select: { id: true }
      });
      await Promise.all([
        this.authStateInvalidator.invalidateSessions(sessions.map((session) => session.id)),
        this.authStateInvalidator.invalidateUserVersions(userId, [authzVersion])
      ]);
    } catch {
      // Non-critical: cache invalidation errors are acceptable since tokens expire naturally.
    }
  }

  private async loadCheckoutAddress(userId: string, selectedAddressId: string | undefined) {
    const selected = selectedAddressId
      ? await this.prisma.address.findFirst({
          where: { id: selectedAddressId, userId, deletedAt: null },
          select: { id: true }
        })
      : null;
    const address = selected ?? (await this.prisma.address.findFirst({
      where: { userId, deletedAt: null },
      orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
      select: { id: true }
    }));
    return address ? checkoutAddressHint(address) : null;
  }

  private deleteConfirmationHash(userId: string, email: string, nonce: string, code: string) {
    return this.crypto.hmac(
      ["account_delete", userId, email.toLowerCase(), nonce, code].join(":"),
      this.crypto.pepper("OTP_PEPPER")
    );
  }

  private verifyDeleteOtp(
    userId: string,
    email: string,
    code: string,
    request: { confirmationNonce: string; confirmationHash: string }
  ) {
    const computed = this.deleteConfirmationHash(userId, email, request.confirmationNonce, code);
    return this.crypto.timingSafeEqual(computed, request.confirmationHash);
  }
}

function mapProfile(row: Awaited<ReturnType<CustomerAccountService["profileRow"]>>) {
  return {
    id: row.id,
    email: row.email,
    fullName: row.fullName,
    avatarUrl: row.avatarUrl,
    phone: row.phone ?? row.customerProfile?.phone ?? null,
    emailVerified: row.emailVerified,
    marketingOptIn: row.customerProfile?.marketingOptIn ?? false,
    loyaltyTier: row.customerProfile?.loyaltyTier ?? "STANDARD",
    providerType: row.providerType,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    profileVersion: row.updatedAt.toISOString()
  };
}

function safeAddress(address: {
  id: string;
  label: string | null;
  recipientName: string | null;
  recipientPhone: string | null;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  pincode: string;
  latitude: Prisma.Decimal | null;
  longitude: Prisma.Decimal | null;
  deliveryInstructions: string | null;
  isDefault: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: address.id,
    label: address.label,
    recipientName: address.recipientName,
    recipientPhone: address.recipientPhone,
    line1: address.line1,
    line2: address.line2,
    city: address.city,
    state: address.state,
    pincode: address.pincode,
    latitude: decimalToNumber(address.latitude),
    longitude: decimalToNumber(address.longitude),
    deliveryInstructions: address.deliveryInstructions,
    isDefault: address.isDefault,
    addressVersion: address.version,
    createdAt: address.createdAt.toISOString(),
    updatedAt: address.updatedAt.toISOString()
  };
}

function checkoutAddressHint(address: { id: string }): CheckoutAddressHint {
  return { id: address.id };
}

function uuidOrUndefined(value: string | undefined) {
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : undefined;
}

function safeOrder(order: {
  id: string;
  status: string;
  paymentMethod: string;
  paymentStatus: string;
  subtotal: Prisma.Decimal;
  deliveryFee: Prisma.Decimal;
  total: Prisma.Decimal;
  customerNote: string | null;
  createdAt: Date;
  updatedAt: Date;
  addressRecipientName: string | null;
  addressRecipientPhone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  addressCity: string | null;
  addressState: string | null;
  addressPincode: string | null;
  store: { id: string; name: string; slug: string; imageUrl: string | null };
  address: {
    recipientName: string | null;
    recipientPhone: string | null;
    line1: string;
    line2: string | null;
    city: string;
    state: string;
    pincode: string;
  } | null;
  payment: { id: string; method: string; status: string; amount: Prisma.Decimal; createdAt: Date } | null;
  items: Array<{
    id: string;
    productId: string;
    variantId: string | null;
    name: string;
    variantName: string | null;
    unitDisplay: string | null;
    quantity: number;
    unitPrice: Prisma.Decimal;
    mrp: Prisma.Decimal | null;
    total: Prisma.Decimal;
  }>;
}) {
  return {
    id: order.id,
    status: order.status,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    subtotal: decimalToNumber(order.subtotal),
    deliveryFee: decimalToNumber(order.deliveryFee),
    total: decimalToNumber(order.total),
    customerNote: order.customerNote,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    store: order.store,
    address: {
      recipientName: order.addressRecipientName ?? order.address?.recipientName ?? null,
      recipientPhone: order.addressRecipientPhone ?? order.address?.recipientPhone ?? null,
      line1: order.addressLine1 ?? order.address?.line1 ?? null,
      line2: order.addressLine2 ?? order.address?.line2 ?? null,
      city: order.addressCity ?? order.address?.city ?? null,
      state: order.addressState ?? order.address?.state ?? null,
      pincode: order.addressPincode ?? order.address?.pincode ?? null
    },
    payment: order.payment
      ? {
          id: order.payment.id,
          method: order.payment.method,
          status: order.payment.status,
          amount: decimalToNumber(order.payment.amount),
          createdAt: order.payment.createdAt.toISOString()
        }
      : null,
    items: order.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      variantId: item.variantId,
      name: item.name,
      variantName: item.variantName,
      unitDisplay: item.unitDisplay,
      quantity: item.quantity,
      unitPrice: decimalToNumber(item.unitPrice),
      mrp: decimalToNumber(item.mrp),
      total: decimalToNumber(item.total)
    }))
  };
}

function safeSession(
  session: {
    id: string;
    userAgent: string | null;
    deviceMetadata: Prisma.JsonValue | null;
    createdAt: Date;
    lastSeenAt: Date;
    expiresAt: Date;
  },
  currentSessionId: string
) {
  const metadata = jsonRecord(session.deviceMetadata);
  return {
    id: session.id,
    deviceLabel: deviceLabel(session.userAgent),
    browser: browserLabel(session.userAgent),
    os: osLabel(session.userAgent),
    timezone: stringValue(metadata.timezone),
    language: stringValue(metadata.language ?? metadata.acceptLanguage),
    current: session.id === currentSessionId,
    createdAt: session.createdAt.toISOString(),
    lastSeenAt: session.lastSeenAt.toISOString(),
    expiresAt: session.expiresAt.toISOString()
  };
}

function addressData(dto: CreateAddressDto) {
  return {
    label: cleanOptional(dto.label),
    recipientName: cleanOptional(dto.recipientName),
    recipientPhone: cleanOptional(dto.recipientPhone),
    line1: dto.line1.trim(),
    line2: cleanOptional(dto.line2),
    city: dto.city.trim(),
    state: dto.state.trim(),
    pincode: dto.pincode.trim(),
    latitude: dto.latitude,
    longitude: dto.longitude,
    deliveryInstructions: cleanOptional(dto.deliveryInstructions)
  };
}

function avatarRenditions(publicId: string, version: number | undefined, cloudinary: CloudinaryMediaProvider) {
  const specs = {
    thumbnail: { kind: UploadRenditionKind.THUMBNAIL, width: 96, height: 96, transformation: "c_fill,g_auto,w_96,h_96,f_webp,q_82" },
    card: { kind: UploadRenditionKind.CARD, width: 256, height: 256, transformation: "c_fill,g_auto,w_256,h_256,f_webp,q_84" },
    detail: { kind: UploadRenditionKind.DETAIL, width: 512, height: 512, transformation: "c_fill,g_auto,w_512,h_512,f_webp,q_86" }
  };
  return Object.fromEntries(
    Object.entries(specs).map(([key, spec]) => [
      key,
      {
        ...spec,
        secureUrl: cloudinary.transformedUrl({ publicId, version, transformation: spec.transformation })
      }
    ])
  ) as Record<"thumbnail" | "card" | "detail", {
    kind: UploadRenditionKind;
    width: number;
    height: number;
    transformation: string;
    secureUrl: string;
  }>;
}

function sniffImage(buffer: Buffer): { mimeType: string } {
  if (buffer.length < 12) {
    throw new BadRequestException({ code: "AVATAR_CORRUPT_IMAGE", message: "Image file is incomplete." });
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { mimeType: "image/jpeg" };
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mimeType: "image/png" };
  if (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return { mimeType: "image/webp" };
  const gif = buffer.subarray(0, 6).toString("ascii");
  if (gif === "GIF87a" || gif === "GIF89a") return { mimeType: "image/gif" };
  throw new BadRequestException({ code: "AVATAR_UNSUPPORTED_FORMAT", message: "Use a JPG, PNG, WebP, or GIF image." });
}

function cleanOptional(value: string | undefined) {
  const normalized = value?.trim().replace(/\s+/g, " ");
  return normalized ? normalized : undefined;
}

function decimalToNumber(value: Prisma.Decimal | null) {
  return value === null ? null : Number(value);
}

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function sanitizeFilename(value: string): string {
  const cleaned = value.replace(/[^\w.\- ()]/g, "_").replace(/\s+/g, " ").trim();
  return cleaned.slice(0, 180) || "avatar.webp";
}

function minutesFromNow(minutes: number): Date {
  return new Date(Date.now() + minutes * 60 * 1000);
}

function secondsFromNow(seconds: number): Date {
  return new Date(Date.now() + seconds * 1000);
}

function jsonRecord(value: Prisma.JsonValue | null): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function deviceLabel(userAgent: string | null) {
  const os = osLabel(userAgent);
  const browser = browserLabel(userAgent);
  return [browser, os].filter(Boolean).join(" on ") || "Unknown device";
}

function browserLabel(userAgent: string | null) {
  const ua = userAgent ?? "";
  if (/Edg\//.test(ua)) return "Edge";
  if (/Chrome\//.test(ua)) return "Chrome";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Safari\//.test(ua)) return "Safari";
  return "Browser";
}

function osLabel(userAgent: string | null) {
  const ua = userAgent ?? "";
  if (/Windows/i.test(ua)) return "Windows";
  if (/Mac OS X|Macintosh/i.test(ua)) return "macOS";
  if (/Android/i.test(ua)) return "Android";
  if (/iPhone|iPad/i.test(ua)) return "iOS";
  if (/Linux/i.test(ua)) return "Linux";
  return "Unknown OS";
}

function maskEmail(email: string) {
  const [name = "", domain = ""] = email.split("@");
  return `${name.slice(0, 2)}***@${domain}`;
}
