import { Type } from "class-transformer";
import {
  IsBoolean,
  IsEmail,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf
} from "class-validator";
import { PASSWORD_POLICY_MESSAGE } from "../../auth/dto/auth.dto";

const PHONE_PATTERN = /^\+?[0-9][0-9 ()-]{6,31}$/;
const PINCODE_PATTERN = /^[1-9][0-9]{5}$/;
const PASSWORD_NUMBER_OR_SYMBOL_PATTERN = /^(?=.*(?:\d|[^A-Za-z0-9])).+$/;

export class UpdateProfileDto {
  @IsISO8601()
  profileVersion!: string;

  @IsOptional()
  @IsString()
  @Length(2, 120)
  fullName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  @Matches(PHONE_PATTERN, { message: "Enter a valid phone number." })
  phone?: string | null;

  @IsOptional()
  @IsBoolean()
  marketingOptIn?: boolean;
}

export class CreateAddressDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  label?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  recipientName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  @Matches(PHONE_PATTERN, { message: "Enter a valid recipient phone number." })
  recipientPhone?: string;

  @IsString()
  @Length(2, 180)
  line1!: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  line2?: string;

  @IsString()
  @Length(2, 80)
  city!: string;

  @IsString()
  @Length(2, 80)
  state!: string;

  @IsString()
  @Matches(PINCODE_PATTERN, { message: "Enter a valid 6-digit pincode." })
  pincode!: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  deliveryInstructions?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateAddressDto extends CreateAddressDto {
  @IsNumber()
  @Type(() => Number)
  addressVersion!: number;
}

export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  currentPassword!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(PASSWORD_NUMBER_OR_SYMBOL_PATTERN, { message: PASSWORD_POLICY_MESSAGE })
  newPassword!: string;
}

export class RequestEmailChangeDto {
  @IsEmail()
  @MaxLength(320)
  newEmail!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  currentPassword!: string;
}

export class ConfirmEmailChangeDto {
  @IsEmail()
  @MaxLength(320)
  newEmail!: string;

  @IsString()
  @Matches(/^\d{6}$/)
  otp!: string;
}

export class DeleteAccountDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  currentPassword?: string;

  @ValidateIf((dto: DeleteAccountDto) => !dto.currentPassword)
  @IsString()
  @Matches(/^\d{6}$/)
  otp?: string;
}
