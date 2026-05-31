import { Type } from "class-transformer";
import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, Max, Min } from "class-validator";

export class InventoryAdjustmentDto {
  @IsUUID()
  storeId!: string;

  @IsUUID()
  productVariantId!: string;

  @IsOptional()
  @IsUUID()
  locationId?: string;

  @IsInt()
  @Min(-1000000)
  @Max(1000000)
  deltaAvailableStock!: number;

  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @IsString()
  reason!: string;

  @IsString()
  idempotencyKey!: string;
}

export class InventoryReconcileDto {
  @IsUUID()
  storeId!: string;

  @IsOptional()
  @IsUUID()
  locationId?: string;

  @IsOptional()
  @IsUUID()
  productVariantId?: string;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  dryRun?: boolean = true;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  @Type(() => Number)
  chunkSize?: number = 500;
}
