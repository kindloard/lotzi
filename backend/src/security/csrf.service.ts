import { Injectable } from "@nestjs/common";
import { CryptoService } from "./crypto.service";

@Injectable()
export class CsrfService {
  constructor(private readonly crypto: CryptoService) {}

  createToken(sessionId: string): string {
    const nonce = this.crypto.randomBase64Url(16);
    const signature = this.crypto.hmac(
      `${sessionId}:${nonce}`,
      this.crypto.pepper("CSRF_PEPPER")
    );
    return `${nonce}.${signature}`;
  }

  verify(token: string | undefined, sessionId: string): boolean {
    if (!token) {
      return false;
    }
    const [nonce, signature] = token.split(".");
    if (!nonce || !signature) {
      return false;
    }
    const expected = this.crypto.hmac(
      `${sessionId}:${nonce}`,
      this.crypto.pepper("CSRF_PEPPER")
    );
    return this.crypto.timingSafeEqual(signature, expected);
  }
}
