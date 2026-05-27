import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Razorpay = require("razorpay");

@Injectable()
export class RazorpayService {
  private client?: Razorpay;
  private readonly keyId?: string;
  private readonly keySecret?: string;

  constructor(config: ConfigService) {
    this.keyId = config.get<string>("RAZORPAY_KEY_ID");
    this.keySecret = config.get<string>("RAZORPAY_KEY_SECRET");
  }

  getClient(): Razorpay {
    if (this.client) {
      return this.client;
    }
    if (!this.keyId || !this.keySecret) {
      throw new Error("Razorpay credentials are not configured.");
    }
    this.client = new Razorpay({
      key_id: this.keyId,
      key_secret: this.keySecret
    });
    return this.client;
  }
}
