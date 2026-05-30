import { Module } from "@nestjs/common";
import { CryptoService } from "./crypto.service";
import { CsrfService } from "./csrf.service";
import { DeviceFingerprintService } from "./device-fingerprint.service";
import { OtpService } from "./otp.service";
import { PasswordService } from "./password.service";
import { PhoneNumberService } from "./phone-number.service";
import { TokenService } from "./token.service";

@Module({
  providers: [
    CryptoService,
    CsrfService,
    DeviceFingerprintService,
    OtpService,
    PasswordService,
    PhoneNumberService,
    TokenService
  ],
  exports: [
    CryptoService,
    CsrfService,
    DeviceFingerprintService,
    OtpService,
    PasswordService,
    PhoneNumberService,
    TokenService
  ]
})
export class SecurityModule {}
