import {
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min
} from "class-validator";

const stepValues = ["BUSINESS", "BRANDING", "LEGAL", "LOCATION", "PREFERENCES", "REVIEW"] as const;
const mediaKinds = ["LOGO", "BANNER"] as const;
const mediaTypes = ["image/png", "image/jpeg", "image/webp"] as const;

export class DraftPayloadDto {
  @IsObject()
  payload!: Record<string, unknown>;

  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;
}

export class CompleteStepDto extends DraftPayloadDto {}

export class MediaSignatureDto {
  @IsIn(mediaKinds)
  kind!: "LOGO" | "BANNER";

  @IsString()
  @MaxLength(180)
  fileName!: string;

  @IsIn(mediaTypes)
  mimeType!: "image/png" | "image/jpeg" | "image/webp";

  @IsInt()
  @Min(1)
  @Max(6 * 1024 * 1024)
  byteSize!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  width?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  height?: number;
}

export class AttachMediaDto {
  @IsIn(mediaKinds)
  kind!: "LOGO" | "BANNER";

  @IsString()
  @MaxLength(240)
  providerPublicId!: string;

  @IsUrl({ require_tld: false })
  @MaxLength(1200)
  url!: string;

  @IsIn(mediaTypes)
  mimeType!: "image/png" | "image/jpeg" | "image/webp";

  @IsInt()
  @Min(1)
  @Max(6 * 1024 * 1024)
  byteSize!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  width?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  height?: number;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  checksum?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  idempotencyKey?: string;
}

export class LaunchOnboardingDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  idempotencyKey?: string;
}

export function parseOnboardingStep(value: string) {
  const normalized = value.toUpperCase();
  if (!stepValues.includes(normalized as (typeof stepValues)[number])) {
    return null;
  }
  return normalized as (typeof stepValues)[number];
}
