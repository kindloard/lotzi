import { Type } from "class-transformer";
import { IsNumber, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";

export class UpdateStoreLocationDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 7 })
  @Min(-90)
  @Max(90)
  latitude!: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 7 })
  @Min(-180)
  @Max(180)
  longitude!: number;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  addressLine?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  state?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  pincode?: string;
}
