import { Controller, Post, Req } from "@nestjs/common";
import { Request } from "express";
import { WebhookService } from "./webhook.service";

@Controller("v1/webhooks")
export class WebhookController {
  constructor(private readonly webhooks: WebhookService) {}

  @Post("cashfree")
  cashfree(@Req() request: Request & { rawBody?: Buffer }) {
    return this.webhooks.ingestCashfree(request);
  }
}
