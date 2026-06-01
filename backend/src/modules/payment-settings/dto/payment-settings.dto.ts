import { Transform } from "class-transformer";
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min
} from "class-validator";

export class UpdatePhonepeSettingsDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  displayName?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  displayPriority?: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  merchantId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  clientId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  clientSecret?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  clientVersion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  saltKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  saltIndex?: string;

  @IsOptional()
  @IsIn(["SANDBOX", "PRODUCTION"])
  @Transform(({ value }) => (typeof value === "string" ? value.toUpperCase() : value))
  environment?: "SANDBOX" | "PRODUCTION";
}

export class UpdateCodSettingsDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  displayName?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  displayPriority?: number;
}
