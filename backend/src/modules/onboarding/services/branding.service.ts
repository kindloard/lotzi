import { BadRequestException, Injectable } from "@nestjs/common";
import {
  Prisma,
  StoreMediaKind,
  StoreMediaProvider,
  StoreMediaStatus
} from "@prisma/client";
import { PrismaService } from "../../../database/prisma.service";
import { CloudinaryService } from "../../../integrations/cloudinary/cloudinary.service";
import { AuthenticatedPrincipal } from "../../auth/auth.types";
import {
  ALLOWED_MEDIA_MIME_TYPES,
  MEDIA_LIMITS
} from "../onboarding.constants";
import { AttachMediaDto, MediaSignatureDto } from "../dto/onboarding.dto";
import { DomainEventService } from "./domain-event.service";
import { MerchantOnboardingStoreService } from "./merchant-onboarding-store.service";

@Injectable()
export class BrandingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
    private readonly events: DomainEventService,
    private readonly stores: MerchantOnboardingStoreService
  ) {}

  async createSignature(auth: AuthenticatedPrincipal, dto: MediaSignatureDto) {
    const store = await this.stores.requireCurrentStore(auth);
    this.validateMedia({
      kind: dto.kind as StoreMediaKind,
      mimeType: dto.mimeType,
      byteSize: dto.byteSize,
      width: dto.width,
      height: dto.height
    });

    return {
      ...this.cloudinary.createStoreUploadSignature(store.id, "stores"),
      constraints: MEDIA_LIMITS[dto.kind as StoreMediaKind],
      allowedMimeTypes: Array.from(ALLOWED_MEDIA_MIME_TYPES)
    };
  }

  async attach(auth: AuthenticatedPrincipal, dto: AttachMediaDto) {
    const store = await this.stores.requireCurrentStore(auth);
    const kind = dto.kind as StoreMediaKind;
    this.validateMedia({
      kind,
      mimeType: dto.mimeType,
      byteSize: dto.byteSize,
      width: dto.width,
      height: dto.height
    });

    return this.prisma.$transaction(async (tx) => {
      const media = await tx.storeMedia.upsert({
        where: {
          storeId_provider_providerPublicId: {
            storeId: store.id,
            provider: StoreMediaProvider.CLOUDINARY,
            providerPublicId: dto.providerPublicId
          }
        },
        create: {
          storeId: store.id,
          kind,
          provider: StoreMediaProvider.CLOUDINARY,
          providerPublicId: dto.providerPublicId,
          url: dto.url,
          mimeType: dto.mimeType,
          byteSize: dto.byteSize,
          width: dto.width,
          height: dto.height,
          checksum: dto.checksum,
          status: StoreMediaStatus.ATTACHED,
          uploadedByUserId: auth.userId,
          attachedAt: new Date()
        },
        update: {
          kind,
          url: dto.url,
          mimeType: dto.mimeType,
          byteSize: dto.byteSize,
          width: dto.width,
          height: dto.height,
          checksum: dto.checksum,
          status: StoreMediaStatus.ATTACHED,
          attachedAt: new Date()
        }
      });

      await tx.storeBranding.upsert({
        where: { storeId: store.id },
        create: {
          storeId: store.id,
          logoMediaId: kind === StoreMediaKind.LOGO ? media.id : undefined,
          bannerMediaId: kind === StoreMediaKind.BANNER ? media.id : undefined
        },
        update:
          kind === StoreMediaKind.LOGO
            ? { logoMediaId: media.id }
            : { bannerMediaId: media.id }
      });

      await this.events.enqueue(
        {
          eventType: "merchant.branding.uploaded",
          aggregateType: "store",
          aggregateId: store.id,
          payload: {
            mediaId: media.id,
            kind: media.kind,
            url: media.url,
            idempotencyKey: dto.idempotencyKey ?? null
          } as Prisma.InputJsonValue
        },
        tx
      );

      return {
        id: media.id,
        kind: media.kind,
        status: media.status,
        url: media.url
      };
    });
  }

  private validateMedia(input: {
    kind: StoreMediaKind;
    mimeType: string;
    byteSize: number;
    width?: number;
    height?: number;
  }) {
    if (!ALLOWED_MEDIA_MIME_TYPES.has(input.mimeType)) {
      throw new BadRequestException("Only PNG, JPEG, and WebP images are allowed.");
    }

    const limit = MEDIA_LIMITS[input.kind];
    if (input.byteSize > limit.maxBytes) {
      throw new BadRequestException(`${input.kind.toLowerCase()} image is too large.`);
    }

    if (input.width && input.width < limit.minWidth) {
      throw new BadRequestException(`${input.kind.toLowerCase()} image is too narrow.`);
    }

    if (input.height && input.height < limit.minHeight) {
      throw new BadRequestException(`${input.kind.toLowerCase()} image is too short.`);
    }
  }
}
