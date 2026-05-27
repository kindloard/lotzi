import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

@Injectable()
export class CryptoService {
  constructor(private readonly config: ConfigService) {}

  randomBase64Url(bytes: number): string {
    return randomBytes(bytes).toString("base64url");
  }

  hmac(value: string, secret: string): string {
    return createHmac("sha256", secret).update(value).digest("base64url");
  }

  timingSafeEqual(a: string, b: string): boolean {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    if (left.length !== right.length) {
      return false;
    }
    return timingSafeEqual(left, right);
  }

  otpCode(digits: number): string {
    let value = "";
    for (let index = 0; index < digits; index += 1) {
      value += randomInt(0, 10).toString();
    }
    return value;
  }

  pepper(name: string): string {
    const value = this.config.get<string>(name);
    if (!value) {
      throw new Error(`${name} is not configured.`);
    }
    return value;
  }
}
