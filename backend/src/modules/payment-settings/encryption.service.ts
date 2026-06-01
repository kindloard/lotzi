import { Injectable, InternalServerErrorException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const VERSION = "v1";
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

@Injectable()
export class PaymentSettingsEncryptionService {
  constructor(private readonly config: ConfigService) {}

  encrypt(value: string | null | undefined) {
    const normalized = value?.trim();
    if (!normalized) {
      return null;
    }
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.key(), iv, { authTagLength: AUTH_TAG_BYTES });
    const ciphertext = Buffer.concat([cipher.update(normalized, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return [
      VERSION,
      iv.toString("base64"),
      ciphertext.toString("base64"),
      authTag.toString("base64")
    ].join(":");
  }

  decrypt(value: string | null | undefined) {
    if (!value) {
      return null;
    }
    const [version, ivBase64, ciphertextBase64, authTagBase64] = value.split(":");
    if (version !== VERSION || !ivBase64 || !ciphertextBase64 || !authTagBase64) {
      throw new InternalServerErrorException("Encrypted payment setting has an invalid format.");
    }
    const decipher = createDecipheriv("aes-256-gcm", this.key(), Buffer.from(ivBase64, "base64"), {
      authTagLength: AUTH_TAG_BYTES
    });
    decipher.setAuthTag(Buffer.from(authTagBase64, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextBase64, "base64")),
      decipher.final()
    ]).toString("utf8");
  }

  private key() {
    const configured = this.config.get<string>("PHONEPE_ENCRYPTION_KEY");
    if (!configured || configured.length < 32) {
      throw new InternalServerErrorException("PHONEPE_ENCRYPTION_KEY must be configured before storing PhonePe credentials.");
    }
    return createHash("sha256").update(configured).digest();
  }
}
