import { Body, Controller, Get, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import { Response } from "express";
import { requestTimer } from "../../common/request-timing";
import { ObservabilityService } from "../observability/observability.service";
import { AuthenticatedRequest } from "../auth/auth.types";
import { AccessTokenGuard } from "../auth/guards/access-token.guard";
import { CsrfGuard } from "../auth/guards/csrf.guard";
import { PERMISSIONS } from "../rbac/permissions";
import { RbacGuard } from "../rbac/rbac.guard";
import { RequirePermissions } from "../rbac/require-permissions.decorator";
import {
  REQUIRED_CHECKOUT_TIMING_STAGES,
  createCheckoutTraceContext,
  flushCheckoutTrace,
  runCheckoutTraceContext
} from "./checkout-tracing";
import { CheckoutService } from "./checkout.service";
import { CreateCheckoutSessionDto } from "./dto/checkout.dto";

@Controller("v1/checkout")
export class CheckoutController {
  constructor(
    private readonly checkout: CheckoutService,
    private readonly observability: ObservabilityService
  ) {}

  @Get("methods")
  methods(@Query("storeId") storeId?: string) {
    return this.checkout.availableMethods(storeId);
  }

  @Post("session")
  @UseGuards(AccessTokenGuard, RbacGuard, CsrfGuard)
  @RequirePermissions(PERMISSIONS.ORDER_CREATE)
  createSession(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
    @Body() dto: CreateCheckoutSessionDto
  ) {
    const timer = requestTimer(request);
    const traceContext = createCheckoutTraceContext({
      requestId: request.requestId,
      userId: request.auth?.userId,
      paymentMethod: dto.paymentMethod,
      cartLineCount: dto.items?.length
    });

    return runCheckoutTraceContext(traceContext, async () => {
      let outcome: "completed" | "failed" = "completed";
      try {
        return await this.checkout.createSession(request.auth!, dto, request.requestId, timer);
      } catch (error) {
        outcome = "failed";
        throw error;
      } finally {
        timer.ensureStages(REQUIRED_CHECKOUT_TIMING_STAGES.filter((stage) => stage !== "total"));
        timer.finishTotal();
        response.setHeader("Server-Timing", timer.serverTiming());
        const trace = flushCheckoutTrace(timer.entries(), undefined, outcome);
        if (trace?.queryCapReached) {
          this.observability.recordCheckoutTraceQueryCapReached();
        }
      }
    });
  }
}
