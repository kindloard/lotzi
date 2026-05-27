import { IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export class AdminLoginDto {
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  password!: string;
}

export class AdminApprovalDecisionDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class AdminRejectionDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
