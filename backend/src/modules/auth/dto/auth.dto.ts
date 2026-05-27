import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  ValidateIf,
  Length,
  Matches,
  MaxLength,
  MinLength
} from "class-validator";

export const PASSWORD_POLICY_MESSAGE =
  "Password must be 8-128 characters and include at least one number or symbol.";

const PASSWORD_NUMBER_OR_SYMBOL_PATTERN = /^(?=.*(?:\d|[^A-Za-z0-9])).+$/;

export class SignupDto {
  @IsString()
  @Length(2, 120)
  name!: string;

  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(PASSWORD_NUMBER_OR_SYMBOL_PATTERN, { message: PASSWORD_POLICY_MESSAGE })
  password!: string;

  @IsOptional()
  @IsIn(["CUSTOMER", "MERCHANT"])
  accountType?: "CUSTOMER" | "MERCHANT";

  @ValidateIf((dto: SignupDto) => dto.accountType === "MERCHANT")
  @IsString()
  @Length(2, 160)
  storeName?: string;
}

export class VerifySignupOtpDto {
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsString()
  @Matches(/^\d{6}$/)
  otp!: string;
}

export class ResendOtpDto {
  @IsEmail()
  @MaxLength(320)
  email!: string;
}

export class LoginDto {
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;

  @IsOptional()
  @IsBoolean()
  remember?: boolean;
}

export class GoogleLoginDto {
  @IsString()
  @MinLength(20)
  idToken!: string;
}

export class GoogleLinkDto {
  @IsString()
  @MinLength(20)
  idToken!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  @Matches(PASSWORD_NUMBER_OR_SYMBOL_PATTERN, { message: PASSWORD_POLICY_MESSAGE })
  password!: string;
}

export class PasswordResetRequestDto {
  @IsEmail()
  @MaxLength(320)
  email!: string;
}

export class PasswordResetConfirmDto {
  @IsString()
  @MinLength(32)
  token!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(PASSWORD_NUMBER_OR_SYMBOL_PATTERN, { message: PASSWORD_POLICY_MESSAGE })
  newPassword!: string;
}

export class RejectedRedirectDto {
  @IsString()
  @MaxLength(2048)
  value!: string;

  @IsString()
  @MaxLength(160)
  reason!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  sessionId?: string;
}

export class RevokeSessionDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
