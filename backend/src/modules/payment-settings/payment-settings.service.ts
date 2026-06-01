import { BadRequestException, ForbiddenException, HttpStatus, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PaymentProvider, Prisma, ShopPaymentSettings } from "@prisma/client";
import { PhonepeClient, PhonepeCredentials, PhonepeEnvironment } from "../../integrations/phonepe/phonepe.client";
import { PrismaService } from "../../database/prisma.service";
import { AuthenticatedPrincipal } from "../auth/auth.types";
import { paymentError } from "../payments/payment.errors";
import { PERMISSIONS } from "../rbac/permissions";
import { RbacEngine } from "../rbac/rbac.engine";
import { UpdateCodSettingsDto, UpdatePhonepeSettingsDto } from "./dto/payment-settings.dto";
import { PaymentSettingsEncryptionService } from "./encryption.service";

const DEFAULT_PHONEPE_NAME = "PhonePe";
const DEFAULT_COD_NAME = "Cash on Delivery";

@Injectable()
export class PaymentSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly encryption: PaymentSettingsEncryptionService,
    private readonly phonepe: PhonepeClient,
    private readonly rbac: RbacEngine
  ) {}

  async getSettings(auth: AuthenticatedPrincipal, storeId: string) {
    await this.assertCanManageStore(auth, storeId);
    const [settings, auditTrail] = await Promise.all([
      this.prisma.shopPaymentSettings.findMany({ where: { storeId } }),
      this.prisma.phonepeAuditLog.findMany({
        where: { storeId },
        orderBy: { createdAt: "desc" },
        take: 5
      })
    ]);
    const byProvider = new Map(settings.map((setting) => [setting.provider, setting]));
    const phonepe = byProvider.get(PaymentProvider.PHONEPE);
    const cod = byProvider.get(PaymentProvider.COD);

    return {
      apiVersion: "v1",
      storeId,
      providers: [
        {
          provider: "cashfree",
          enabled: this.isCashfreeConfigured(),
          configured: this.isCashfreeConfigured(),
          readonly: true,
          displayName: "Pay Online (Cashfree)",
          displayPriority: 1,
          environment: this.config.get<string>("CASHFREE_ENV", "sandbox").toUpperCase()
        },
        this.publicPhonepe(phonepe),
        this.publicCod(cod)
      ],
      auditTrail: auditTrail.map((event) => ({
        id: event.id,
        action: event.action,
        actorUserId: event.actorUserId,
        details: event.details,
        createdAt: event.createdAt.toISOString()
      }))
    };
  }

  async updatePhonepeSettings(
    auth: AuthenticatedPrincipal,
    storeId: string,
    dto: UpdatePhonepeSettingsDto,
    context: { requestId?: string; ipAddress?: string }
  ) {
    await this.assertCanManageStore(auth, storeId);
    const existing = await this.prisma.shopPaymentSettings.findUnique({
      where: { storeId_provider: { storeId, provider: PaymentProvider.PHONEPE } }
    });

    const clientIdEncrypted = this.secretForUpdate(dto.clientId, existing?.clientIdEncrypted);
    const clientSecretEncrypted = this.secretForUpdate(dto.clientSecret, existing?.clientSecretEncrypted);
    const saltKeyEncrypted = this.secretForUpdate(dto.saltKey, existing?.saltKeyEncrypted);
    const enabled = dto.enabled ?? existing?.enabled ?? false;
    const merchantId = optionalText(dto.merchantId, existing?.merchantId ?? null);
    const clientVersion = optionalText(dto.clientVersion, existing?.clientVersion ?? "1") ?? "1";

    if (enabled && (!merchantId || !clientIdEncrypted || !clientSecretEncrypted)) {
      throw new BadRequestException({
        code: "PHONEPE_SETTINGS_INCOMPLETE",
        message: "PhonePe merchant ID, client ID, and client secret are required before enabling PhonePe."
      });
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.shopPaymentSettings.upsert({
        where: { storeId_provider: { storeId, provider: PaymentProvider.PHONEPE } },
        update: {
          enabled,
          displayName: optionalText(dto.displayName, existing?.displayName ?? DEFAULT_PHONEPE_NAME),
          displayPriority: dto.displayPriority ?? existing?.displayPriority ?? 2,
          merchantId,
          clientIdEncrypted,
          clientSecretEncrypted,
          clientVersion,
          saltKeyEncrypted,
          saltIndex: optionalText(dto.saltIndex, existing?.saltIndex ?? null),
          environment: dto.environment ?? existing?.environment ?? "SANDBOX",
          configVersion: { increment: 1 }
        },
        create: {
          storeId,
          provider: PaymentProvider.PHONEPE,
          enabled,
          displayName: optionalText(dto.displayName, DEFAULT_PHONEPE_NAME),
          displayPriority: dto.displayPriority ?? 2,
          merchantId,
          clientIdEncrypted,
          clientSecretEncrypted,
          clientVersion,
          saltKeyEncrypted,
          saltIndex: optionalText(dto.saltIndex, null),
          environment: dto.environment ?? "SANDBOX"
        }
      });
      await tx.phonepeAuditLog.create({
        data: {
          storeId,
          actorUserId: auth.userId,
          action: "payment_settings.phonepe.updated",
          requestId: context.requestId,
          ipAddress: context.ipAddress,
          details: {
            enabled,
            environment: saved.environment,
            merchantChanged: dto.merchantId !== undefined,
            clientIdChanged: secretWasChanged(dto.clientId),
            clientSecretChanged: secretWasChanged(dto.clientSecret),
            saltKeyChanged: secretWasChanged(dto.saltKey)
          } as Prisma.InputJsonValue
        }
      });
      return saved;
    });

    return { apiVersion: "v1", provider: this.publicPhonepe(updated) };
  }

  async updateCodSettings(
    auth: AuthenticatedPrincipal,
    storeId: string,
    dto: UpdateCodSettingsDto,
    context: { requestId?: string; ipAddress?: string }
  ) {
    await this.assertCanManageStore(auth, storeId);
    const existing = await this.prisma.shopPaymentSettings.findUnique({
      where: { storeId_provider: { storeId, provider: PaymentProvider.COD } }
    });
    const enabled = dto.enabled ?? existing?.enabled ?? false;
    const updated = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.shopPaymentSettings.upsert({
        where: { storeId_provider: { storeId, provider: PaymentProvider.COD } },
        update: {
          enabled,
          displayName: optionalText(dto.displayName, existing?.displayName ?? DEFAULT_COD_NAME),
          displayPriority: dto.displayPriority ?? existing?.displayPriority ?? 3,
          configVersion: { increment: 1 }
        },
        create: {
          storeId,
          provider: PaymentProvider.COD,
          enabled,
          displayName: optionalText(dto.displayName, DEFAULT_COD_NAME),
          displayPriority: dto.displayPriority ?? 3
        }
      });
      await tx.phonepeAuditLog.create({
        data: {
          storeId,
          actorUserId: auth.userId,
          action: "payment_settings.cod.updated",
          requestId: context.requestId,
          ipAddress: context.ipAddress,
          details: { enabled } as Prisma.InputJsonValue
        }
      });
      return saved;
    });
    return { apiVersion: "v1", provider: this.publicCod(updated) };
  }

  async testPhonepeConnection(
    auth: AuthenticatedPrincipal,
    storeId: string,
    context: { requestId?: string; ipAddress?: string }
  ) {
    await this.assertCanManageStore(auth, storeId);
    const credentials = await this.resolvePhonepeCredentials(storeId, { requireEnabled: false });
    try {
      await this.phonepe.testConnection(credentials);
      await this.prisma.$transaction(async (tx) => {
        await tx.shopPaymentSettings.update({
          where: { storeId_provider: { storeId, provider: PaymentProvider.PHONEPE } },
          data: { lastTestedAt: new Date() }
        });
        await tx.phonepeAuditLog.create({
          data: {
            storeId,
            actorUserId: auth.userId,
            action: "payment_settings.phonepe.tested",
            requestId: context.requestId,
            ipAddress: context.ipAddress,
            details: { status: "success" } as Prisma.InputJsonValue
          }
        });
      });
      return { apiVersion: "v1", status: "success", message: "PhonePe credentials were accepted." };
    } catch (error) {
      await this.prisma.phonepeAuditLog.create({
        data: {
          storeId,
          actorUserId: auth.userId,
          action: "payment_settings.phonepe.test_failed",
          requestId: context.requestId,
          ipAddress: context.ipAddress,
          details: {
            status: "error",
            message: error instanceof Error ? error.message : String(error)
          } as Prisma.InputJsonValue
        }
      }).catch(() => undefined);
      return {
        apiVersion: "v1",
        status: "error",
        message: error instanceof Error ? error.message : "PhonePe connection failed."
      };
    }
  }

  async resolvePhonepeCredentials(
    storeId: string,
    options: { requireEnabled?: boolean } = {}
  ): Promise<PhonepeCredentials> {
    const setting = await this.prisma.shopPaymentSettings.findUnique({
      where: { storeId_provider: { storeId, provider: PaymentProvider.PHONEPE } }
    });
    if (!setting || (options.requireEnabled !== false && !setting.enabled)) {
      throw paymentError(HttpStatus.SERVICE_UNAVAILABLE, "PHONEPE_NOT_ENABLED", "PhonePe is not enabled for this store.", true, undefined, 60);
    }
    const merchantId = setting.merchantId?.trim();
    const clientId = this.encryption.decrypt(setting.clientIdEncrypted);
    const clientSecret = this.encryption.decrypt(setting.clientSecretEncrypted);
    if (!merchantId || !clientId || !clientSecret) {
      throw paymentError(HttpStatus.SERVICE_UNAVAILABLE, "PHONEPE_NOT_CONFIGURED", "PhonePe is missing required credentials.", true, undefined, 60);
    }
    return {
      merchantId,
      clientId,
      clientSecret,
      clientVersion: setting.clientVersion?.trim() || "1",
      saltKey: this.encryption.decrypt(setting.saltKeyEncrypted),
      saltIndex: setting.saltIndex,
      environment: normalizeEnvironment(setting.environment)
    };
  }

  async getStoreProviderSettings(storeId: string) {
    return this.prisma.shopPaymentSettings.findMany({ where: { storeId, enabled: true } });
  }

  async isProviderEnabled(storeId: string, provider: PaymentProvider) {
    const setting = await this.prisma.shopPaymentSettings.findUnique({
      where: { storeId_provider: { storeId, provider } },
      select: { enabled: true }
    });
    return Boolean(setting?.enabled);
  }

  isCashfreeConfigured() {
    return Boolean(this.config.get<string>("CASHFREE_APP_ID") && this.config.get<string>("CASHFREE_SECRET_KEY"));
  }

  private secretForUpdate(value: string | undefined, existing: string | null | undefined) {
    if (value === undefined || isMaskedSecret(value) || !value.trim()) {
      return existing ?? null;
    }
    return this.encryption.encrypt(value);
  }

  private publicPhonepe(setting: ShopPaymentSettings | undefined | null) {
    const configured = Boolean(setting?.merchantId && setting.clientIdEncrypted && setting.clientSecretEncrypted);
    return {
      provider: "phonepe",
      enabled: Boolean(setting?.enabled),
      configured,
      readonly: false,
      displayName: setting?.displayName ?? DEFAULT_PHONEPE_NAME,
      displayPriority: setting?.displayPriority ?? 2,
      environment: setting?.environment ?? "SANDBOX",
      merchantId: setting?.merchantId ?? "",
      clientVersion: setting?.clientVersion ?? "1",
      saltIndex: setting?.saltIndex ?? "",
      secrets: {
        clientId: setting?.clientIdEncrypted ? "******" : "",
        clientSecret: setting?.clientSecretEncrypted ? "******" : "",
        saltKey: setting?.saltKeyEncrypted ? "******" : ""
      },
      lastTestedAt: setting?.lastTestedAt?.toISOString() ?? null,
      updatedAt: setting?.updatedAt?.toISOString() ?? null
    };
  }

  private publicCod(setting: ShopPaymentSettings | undefined | null) {
    return {
      provider: "cod",
      enabled: Boolean(setting?.enabled),
      configured: true,
      readonly: false,
      displayName: setting?.displayName ?? DEFAULT_COD_NAME,
      displayPriority: setting?.displayPriority ?? 3,
      updatedAt: setting?.updatedAt?.toISOString() ?? null
    };
  }

  private async assertCanManageStore(auth: AuthenticatedPrincipal, storeId: string) {
    const store = await this.prisma.store.findFirst({
      where: { id: storeId, deletedAt: null },
      select: { id: true }
    });
    if (!store) {
      throw new NotFoundException({ code: "STORE_NOT_FOUND", message: "Store not found." });
    }
    if (auth.isPlatformAdmin) {
      return;
    }
    const authorization = await this.rbac.storeAuthorization(auth.userId, storeId, auth.authzVersion);
    if (!this.rbac.hasPermissions(authorization.permissions, [PERMISSIONS.STORE_MANAGE])) {
      throw new ForbiddenException({ code: "STORE_MANAGE_REQUIRED", message: "You cannot manage payment settings for this store." });
    }
  }
}

function optionalText(value: string | undefined, fallback: string | null) {
  if (value === undefined) {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function isMaskedSecret(value: string) {
  const trimmed = value.trim();
  return trimmed === "******" || /^[-*.\u2022]+$/.test(trimmed);
}

function secretWasChanged(value: string | undefined) {
  return value !== undefined && value.trim() !== "" && !isMaskedSecret(value);
}

function normalizeEnvironment(value: string | null): PhonepeEnvironment {
  return value === "PRODUCTION" ? "PRODUCTION" : "SANDBOX";
}
