import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength
} from "class-validator";

const UUID_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const SHA256_PATTERN = "[0-9a-f]{64}";
const UPLOAD_IDEMPOTENCY_KEY_PATTERN = new RegExp(
  `^(?:${UUID_PATTERN}|upload:v1:${UUID_PATTERN}:${SHA256_PATTERN})$`,
  "i"
);

export class UploadImageDto {
  @IsIn(["PRODUCT_IMAGE"])
  purpose!: "PRODUCT_IMAGE";

  @IsUUID()
  storeId!: string;

  @IsString()
  @MaxLength(120)
  draftId!: string;

  @IsString()
  @MaxLength(120)
  clientFileId!: string;

  @IsString()
  @MaxLength(120)
  @Matches(UPLOAD_IDEMPOTENCY_KEY_PATTERN, {
    message: "idempotencyKey must be a UUID or upload:v1 scoped upload key."
  })
  idempotencyKey!: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  declaredMimeType?: string;
}
