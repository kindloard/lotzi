import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested
} from "class-validator";
import { MEASUREMENT_UNITS, PACK_TYPES, UNIT_GROUPS } from "../product-measurement";

const productStatuses = ["Draft", "Published", "Paused", "Needs review"] as const;
const productImageScopes = ["PRODUCT", "VARIANT"] as const;

export class ProductMeasurementInputDto {
  @IsIn(UNIT_GROUPS)
  unitGroup!: (typeof UNIT_GROUPS)[number];

  @IsNumber()
  @Min(0.0001)
  quantityValue!: number;

  @IsIn(MEASUREMENT_UNITS)
  quantityUnit!: (typeof MEASUREMENT_UNITS)[number];

  @IsIn(PACK_TYPES)
  packType!: (typeof PACK_TYPES)[number];
}

export class ProductImageInputDto {
  @IsUUID()
  uploadAssetId!: string;

  @IsInt()
  @Min(0)
  sortOrder!: number;

  @IsBoolean()
  isPrimary!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  altText?: string;

  @IsOptional()
  @IsIn(productImageScopes)
  imageScope?: (typeof productImageScopes)[number];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  variantClientIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  variantSkuIds?: string[];
}

export class ProductVariantInputDto {
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  clientId?: string;

  @IsString()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  sku?: string;

  @IsNumber()
  @Min(0)
  price!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  mrp?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  costPrice?: number;

  @IsInt()
  @Min(0)
  stock!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  stockVersion?: number;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => ProductMeasurementInputDto)
  measurement?: ProductMeasurementInputDto;
}

export class CreateProductDto {
  @IsUUID()
  storeId!: string;

  @IsString()
  @MaxLength(180)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  sku?: string;

  @IsString()
  @MaxLength(120)
  category!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  subCategory?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  productType?: string;

  @IsNumber()
  @Min(0)
  price!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  compareAtPrice?: number;

  @IsInt()
  @Min(0)
  stock!: number;

  @IsInt()
  @Min(0)
  reorderPoint!: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => ProductMeasurementInputDto)
  measurement?: ProductMeasurementInputDto;

  @IsIn(productStatuses)
  status!: (typeof productStatuses)[number];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  seoTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(250)
  seoDescription?: string;

  @IsArray()
  @ArrayMaxSize(8)
  @ValidateNested({ each: true })
  @Type(() => ProductImageInputDto)
  images!: ProductImageInputDto[];

  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ProductVariantInputDto)
  variants!: ProductVariantInputDto[];
}

export class UpdateProductDto {
  @IsUUID()
  storeId!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  expectedCatalogVersion?: number;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  sku?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  subCategory?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  productType?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  compareAtPrice?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  stock?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  reorderPoint?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => ProductMeasurementInputDto)
  measurement?: ProductMeasurementInputDto;

  @IsOptional()
  @IsIn(productStatuses)
  status?: (typeof productStatuses)[number];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  seoTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(250)
  seoDescription?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @ValidateNested({ each: true })
  @Type(() => ProductImageInputDto)
  images?: ProductImageInputDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ProductVariantInputDto)
  variants?: ProductVariantInputDto[];
}

export class ReorderProductImagesDto {
  @IsUUID()
  storeId!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductImageInputDto)
  images!: ProductImageInputDto[];
}

export class ReplaceProductImageDto {
  @IsUUID()
  storeId!: string;

  @IsUUID()
  uploadAssetId!: string;
}
