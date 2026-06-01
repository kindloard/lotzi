import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsString, IsUUID, Max, Min, ValidateNested } from "class-validator";
import { Type } from "class-transformer";

export class CartValidationLineDto {
  @IsUUID()
  productId!: string;

  @IsOptional()
  @IsUUID()
  variantId?: string;

  @IsInt()
  @Min(1)
  @Max(999)
  quantity!: number;
}

export class CartValidationDto {
  @IsOptional()
  @IsString()
  lastSeenCatalogVersion?: string;

  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CartValidationLineDto)
  items!: CartValidationLineDto[];
}
