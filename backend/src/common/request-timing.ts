import type { Request } from "express";

export interface StageTiming {
  stage: string;
  durationMs: number;
}

const timingsKey = Symbol.for("namastore.request.timings");
const startedAtKey = Symbol.for("namastore.request.startedAt");

type TimedRequest = Request & {
  [timingsKey]?: StageTiming[];
  [startedAtKey]?: number;
};

export class RequestTimer {
  constructor(private readonly request: TimedRequest) {
    initRequestTiming(request);
  }

  async time<T>(stage: string, callback: () => Promise<T>): Promise<T> {
    const startedAt = Date.now();
    try {
      return await callback();
    } finally {
      this.add(stage, Date.now() - startedAt);
    }
  }

  timeSync<T>(stage: string, callback: () => T): T {
    const startedAt = Date.now();
    try {
      return callback();
    } finally {
      this.add(stage, Date.now() - startedAt);
    }
  }

  add(stage: string, durationMs: number) {
    requestTimings(this.request).push({ stage, durationMs });
  }

  finishTotal() {
    const timings = requestTimings(this.request);
    const existing = timings.findIndex((item) => item.stage === "total");
    const total = { stage: "total", durationMs: Date.now() - requestStartedAt(this.request) };
    if (existing >= 0) {
      timings[existing] = total;
      return total.durationMs;
    }
    timings.push(total);
    return total.durationMs;
  }

  serverTiming() {
    return serverTiming(requestTimings(this.request));
  }
}

export function initRequestTiming(request: Request) {
  const timed = request as TimedRequest;
  timed[timingsKey] ??= [];
  timed[startedAtKey] ??= Date.now();
}

export function requestTimer(request: Request) {
  return new RequestTimer(request as TimedRequest);
}

function requestTimings(request: TimedRequest) {
  request[timingsKey] ??= [];
  return request[timingsKey];
}

function requestStartedAt(request: TimedRequest) {
  request[startedAtKey] ??= Date.now();
  return request[startedAtKey];
}

function serverTiming(timings: StageTiming[]) {
  return timings
    .map((item) => `${sanitizeStageName(item.stage)};dur=${Math.max(0, item.durationMs).toFixed(1)}`)
    .join(", ");
}

function sanitizeStageName(stage: string) {
  return stage.replace(/[^a-zA-Z0-9_-]/g, "_");
}
