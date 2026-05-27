import { Injectable, Logger } from "@nestjs/common";
import { Response } from "express";
import { performance } from "node:perf_hooks";
import { ObservabilityService } from "../observability/observability.service";

export const AUTH_PERFORMANCE_TARGET_MS = {
  login: 200,
  otp_verify: 300,
  session: 100
} as const;

type AuthFlow = keyof typeof AUTH_PERFORMANCE_TARGET_MS | "signup" | "otp_resend" | "google" | "refresh";

interface TimingEntry {
  step: string;
  durationMs: number;
}

@Injectable()
export class AuthPerformanceService {
  private readonly logger = new Logger(AuthPerformanceService.name);

  constructor(private readonly observability: ObservabilityService) {}

  start(flow: AuthFlow, response?: Response): AuthRequestTimer {
    return new AuthRequestTimer(flow, this.observability, this.logger, response);
  }
}

export class AuthRequestTimer {
  private readonly startedAt = performance.now();
  private readonly entries: TimingEntry[] = [];
  private ended = false;

  constructor(
    private readonly flow: AuthFlow,
    private readonly observability: ObservabilityService,
    private readonly logger: Logger,
    private readonly response?: Response
  ) {}

  async time<T>(step: string, callback: () => Promise<T>): Promise<T> {
    const startedAt = performance.now();
    try {
      return await callback();
    } finally {
      this.record(step, performance.now() - startedAt);
    }
  }

  record(step: string, durationMs: number): void {
    this.entries.push({ step, durationMs });
    this.observability.observeAuthStep(this.flow, step, durationMs);
  }

  end(extraMetadata: Record<string, unknown> = {}): void {
    if (this.ended) {
      return;
    }
    this.ended = true;
    const totalMs = performance.now() - this.startedAt;
    this.record("total", totalMs);
    if (this.response && !this.response.headersSent) {
      this.response.setHeader("Server-Timing", this.serverTimingHeader());
    }

    const target = AUTH_PERFORMANCE_TARGET_MS[this.flow as keyof typeof AUTH_PERFORMANCE_TARGET_MS];
    const overTarget = target !== undefined && totalMs > target;
    const payload = {
      flow: this.flow,
      totalMs: Number(totalMs.toFixed(2)),
      targetMs: target,
      overTarget,
      steps: this.entries.map((entry) => ({
        step: entry.step,
        durationMs: Number(entry.durationMs.toFixed(2))
      })),
      ...extraMetadata
    };

    if (overTarget) {
      this.logger.warn(`Auth performance target missed: ${JSON.stringify(payload)}`);
      return;
    }
    this.logger.debug(`Auth performance: ${JSON.stringify(payload)}`);
  }

  private serverTimingHeader(): string {
    return this.entries
      .map((entry) => {
        const name = `auth_${entry.step.replace(/[^A-Za-z0-9_-]/g, "_")}`;
        return `${name};dur=${entry.durationMs.toFixed(1)}`;
      })
      .join(", ");
  }
}
