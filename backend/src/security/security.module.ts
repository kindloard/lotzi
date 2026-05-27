import { Module } from "@nestjs/common";
import { CryptoService } from "./crypto.service";
import { CsrfService } from "./csrf.service";
import { DeviceFingerprintService } from "./device-fingerprint.service";
import { OtpService } from "./otp.service";
import { PasswordService } from "./password.service";
import { TokenService } from "./token.service";

@Module({
  providers: [
    CryptoService,
    CsrfService,
    DeviceFingerprintService,
    OtpService,
    PasswordService,
    TokenService
  ],
  exports: [
    CryptoService,
    CsrfService,
    DeviceFingerprintService,
    OtpService,
    PasswordService,
    TokenService
  ]
})
export class SecurityModule {}
