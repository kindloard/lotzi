import { IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from "class-validator";

export class RetryPaymentDto {
  @IsString()
  @MaxLength(160)
  idempotencyKey!: string;
}

export class VerifyPaymentDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  idempotencyKey?: string;
}

export class CreateRefundDto {
  @IsInt()
  @Min(1)
  amountPaise!: number;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  reason?: string;

  @IsString()
  @MaxLength(160)
  idempotencyKey!: string;
}

export class PaymentIdParamDto {
  @IsUUID()
  paymentId!: string;
}
