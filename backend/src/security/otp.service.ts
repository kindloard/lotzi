import { Injectable } from "@nestjs/common";
import { CryptoService } from "./crypto.service";
import { OTP_DIGITS } from "./security.constants";

@Injectable()
export class OtpService {
  constructor(private readonly crypto: CryptoService) {}

  generate(): string {
    return this.crypto.otpCode(OTP_DIGITS);
  }

  nonce(): string {
    return this.crypto.randomBase64Url(16);
  }

  hash(code: string, userId: string, email: string, nonce: string, purpose: string): string {
    const pepper = this.crypto.pepper("OTP_PEPPER");
    return this.crypto.hmac(
      [purpose, userId, email.toLowerCase(), nonce, code].join(":"),
      pepper
    );
  }

  hashPhone(code: string, phoneNumber: string, nonce: string): string {
    const pepper = this.crypto.pepper("OTP_PEPPER");
    return this.crypto.hmac(
      ["PHONE_CHECKOUT", phoneNumber, nonce, code].join(":"),
      pepper
    );
  }
}
