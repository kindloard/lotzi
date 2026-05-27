import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Request } from "express";
import { CryptoService } from "./crypto.service";

export interface DeviceContext {
  fingerprint: string;
  ipAddress?: string;
  userAgent?: string;
  metadata: Record<string, string | undefined>;
}

@Injectable()
export class DeviceFingerprintService {
  constructor(
    private readonly crypto: CryptoService,
    private readonly config: ConfigService
  ) {}

  fromRequest(request: Request): DeviceContext {
    const userAgent = request.header("user-agent") ?? "";
    const acceptLanguage = request.header("accept-language") ?? "";
    const acceptEncoding = request.header("accept-encoding") ?? "";
    const timezone = request.header("x-device-timezone");
    const screen = request.header("x-device-screen");
    const language = request.header("x-device-language");
    const ipAddress = this.ipAddress(request);

    const raw = [
      userAgent.trim().toLowerCase(),
      acceptLanguage.trim().toLowerCase(),
      acceptEncoding.trim().toLowerCase()
    ].join("|");

    return {
      fingerprint: this.crypto.hmac(raw, this.crypto.pepper("DEVICE_FINGERPRINT_PEPPER")),
      ipAddress,
      userAgent,
      metadata: {
        timezone,
        screen,
        language,
        acceptLanguage,
        acceptEncoding
      }
    };
  }

  ipAddress(request: Request): string | undefined {
    const forwarded = request.header("x-forwarded-for");
    if (this.config.get<boolean>("TRUST_PROXY_HEADERS") && forwarded) {
      return forwarded.split(",")[0]?.trim();
    }
    return request.ip || request.socket.remoteAddress || undefined;
  }
}
