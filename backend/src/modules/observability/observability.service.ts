import { Injectable, OnModuleInit } from "@nestjs/common";
import * as client from "prom-client";

@Injectable()
export class ObservabilityService implements OnModuleInit {
  readonly registry = new client.Registry();
  readonly authFailures = new client.Counter({
    name: "namastore_auth_failures_total",
    help: "Total authentication failures",
    labelNames: ["flow", "reason"]
  });
  readonly refreshReuse = new client.Counter({
    name: "namastore_refresh_reuse_total",
    help: "Refresh token reuse detections"
  });
  readonly authRefreshRace = new client.Counter({
    name: "namastore_auth_refresh_race_total",
    help: "Refresh token direct-parent race recoveries",
    labelNames: ["reason"]
  });
  readonly authRefreshInvalid = new client.Counter({
    name: "namastore_auth_refresh_invalid_total",
    help: "Invalid refresh token attempts",
    labelNames: ["reason"]
  });
  readonly authAccessMissing = new client.Counter({
    name: "namastore_auth_access_missing_total",
    help: "Protected requests without an access token"
  });
  readonly authAccessInvalid = new client.Counter({
    name: "namastore_auth_access_invalid_total",
    help: "Protected requests with invalid access/session state",
    labelNames: ["reason"]
  });
  readonly authSessionValidated = new client.Counter({
    name: "namastore_auth_session_validated_total",
    help: "Validated protected auth sessions"
  });
  readonly authRefreshLatency = new client.Histogram({
    name: "namastore_auth_refresh_latency_seconds",
    help: "Auth refresh endpoint latency in seconds",
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.2, 0.5, 1, 2, 5]
  });
  readonly otpAbuse = new client.Counter({
    name: "namastore_otp_abuse_total",
    help: "OTP abuse signals",
    labelNames: ["kind"]
  });
  readonly phoneOtpSendTotal = new client.Counter({
    name: "namastore_phone_otp_send_total",
    help: "Phone OTP sends by provider and outcome",
    labelNames: ["provider", "outcome"]
  });
  readonly phoneOtpVerifyTotal = new client.Counter({
    name: "namastore_phone_otp_verify_total",
    help: "Phone OTP verify attempts by provider and outcome",
    labelNames: ["provider", "outcome"]
  });
  readonly phoneOtpProviderFailures = new client.Counter({
    name: "namastore_phone_otp_provider_failures_total",
    help: "Phone OTP provider failures by provider and reason",
    labelNames: ["provider", "reason"]
  });
  readonly phoneOtpIdempotentSends = new client.Counter({
    name: "namastore_phone_otp_idempotent_send_hits_total",
    help: "Phone OTP send requests served from idempotency or cooldown"
  });
  readonly phoneOtpProofFailures = new client.Counter({
    name: "namastore_phone_otp_proof_failures_total",
    help: "Phone OTP proof validation failures by reason",
    labelNames: ["reason"]
  });
  readonly phoneOtpCircuitState = new client.Gauge({
    name: "namastore_phone_otp_circuit_state",
    help: "Phone OTP provider circuit state: 0 closed, 1 half-open, 2 open",
    labelNames: ["provider"]
  });
  readonly authStepDuration = new client.Histogram({
    name: "namastore_auth_step_duration_seconds",
    help: "Auth endpoint step duration in seconds",
    labelNames: ["flow", "step"],
    buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.2, 0.3, 0.5, 1, 2, 5]
  });
  readonly uploadRequests = new client.Counter({
    name: "namastore_upload_requests_total",
    help: "Total upload engine requests by purpose, status, stage, and source format",
    labelNames: ["purpose", "status", "stage", "format"]
  });
  readonly uploadStageDuration = new client.Histogram({
    name: "namastore_upload_stage_duration_seconds",
    help: "Upload engine stage duration in seconds",
    labelNames: ["purpose", "stage", "format"],
    buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 8, 10, 15, 30]
  });
  readonly uploadBytes = new client.Counter({
    name: "namastore_upload_bytes_total",
    help: "Total bytes processed by upload engine",
    labelNames: ["purpose", "format", "rendition"]
  });
  readonly uploadFailures = new client.Counter({
    name: "namastore_upload_failures_total",
    help: "Upload engine failures by category",
    labelNames: ["purpose", "category"]
  });
  readonly uploadCleanupFailed = new client.Counter({
    name: "namastore_upload_cleanup_failed_total",
    help: "Upload cleanup failures by purpose and outcome",
    labelNames: ["purpose", "outcome"]
  });
  readonly cloudinaryRequests = new client.Counter({
    name: "namastore_cloudinary_requests_total",
    help: "Cloudinary requests by operation and status",
    labelNames: ["operation", "status"]
  });
  readonly cloudinaryDuration = new client.Histogram({
    name: "namastore_cloudinary_duration_seconds",
    help: "Cloudinary request duration in seconds",
    labelNames: ["operation"],
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 8, 12, 20]
  });
  readonly uploadOrphans = new client.Gauge({
    name: "namastore_upload_orphans_total",
    help: "Observed upload orphans by purpose and age bucket",
    labelNames: ["purpose", "age_bucket"]
  });
  readonly uploadOrphanOriginals = new client.Gauge({
    name: "namastore_upload_orphan_originals",
    help: "Original Cloudinary assets waiting for upload cleanup by age bucket",
    labelNames: ["age_bucket"]
  });
  readonly uploadCircuitState = new client.Gauge({
    name: "namastore_upload_circuit_state",
    help: "Upload provider circuit state: 0 closed, 1 half-open, 2 open",
    labelNames: ["provider"]
  });
  readonly i18nFallbacks = new client.Counter({
    name: "namastore_i18n_fallback_total",
    help: "Client-observed translation fallbacks by locale, namespace, key, and normalized route template",
    labelNames: ["locale", "namespace", "key", "route_template"]
  });
  readonly shopPageRequests = new client.Counter({
    name: "namastore_shop_page_requests_total",
    help: "Public shop page API requests by endpoint, status, and cache outcome",
    labelNames: ["endpoint", "status", "cache"]
  });
  readonly shopPageDuration = new client.Histogram({
    name: "namastore_shop_page_duration_seconds",
    help: "Public shop page API duration in seconds by endpoint and cache outcome",
    labelNames: ["endpoint", "cache"],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.15, 0.25, 0.5, 0.8, 1.5, 2.5, 5]
  });
  readonly shopPageCacheEvents = new client.Counter({
    name: "namastore_shop_page_cache_events_total",
    help: "Public shop page cache events by event and key family",
    labelNames: ["event", "key_family"]
  });
  readonly shopPageProductsReturned = new client.Histogram({
    name: "namastore_shop_page_products_returned_bucket",
    help: "Number of products returned by public shop product listing requests",
    buckets: [0, 1, 4, 8, 12, 24, 48]
  });
  readonly shopPageRateLimited = new client.Counter({
    name: "namastore_shop_page_rate_limited_total",
    help: "Public shop page rate limited requests by endpoint",
    labelNames: ["endpoint"]
  });
  readonly checkoutTraceQueryCapReached = new client.Counter({
    name: "namastore_checkout_trace_query_cap_reached_total",
    help: "Checkout trace requests that reached the per-request query trace cap"
  });

  onModuleInit() {
    client.collectDefaultMetrics({ register: this.registry });
    this.registry.registerMetric(this.authFailures);
    this.registry.registerMetric(this.refreshReuse);
    this.registry.registerMetric(this.authRefreshRace);
    this.registry.registerMetric(this.authRefreshInvalid);
    this.registry.registerMetric(this.authAccessMissing);
    this.registry.registerMetric(this.authAccessInvalid);
    this.registry.registerMetric(this.authSessionValidated);
    this.registry.registerMetric(this.authRefreshLatency);
    this.registry.registerMetric(this.otpAbuse);
    this.registry.registerMetric(this.phoneOtpSendTotal);
    this.registry.registerMetric(this.phoneOtpVerifyTotal);
    this.registry.registerMetric(this.phoneOtpProviderFailures);
    this.registry.registerMetric(this.phoneOtpIdempotentSends);
    this.registry.registerMetric(this.phoneOtpProofFailures);
    this.registry.registerMetric(this.phoneOtpCircuitState);
    this.registry.registerMetric(this.authStepDuration);
    this.registry.registerMetric(this.uploadRequests);
    this.registry.registerMetric(this.uploadStageDuration);
    this.registry.registerMetric(this.uploadBytes);
    this.registry.registerMetric(this.uploadFailures);
    this.registry.registerMetric(this.uploadCleanupFailed);
    this.registry.registerMetric(this.cloudinaryRequests);
    this.registry.registerMetric(this.cloudinaryDuration);
    this.registry.registerMetric(this.uploadOrphans);
    this.registry.registerMetric(this.uploadOrphanOriginals);
    this.registry.registerMetric(this.uploadCircuitState);
    this.registry.registerMetric(this.i18nFallbacks);
    this.registry.registerMetric(this.shopPageRequests);
    this.registry.registerMetric(this.shopPageDuration);
    this.registry.registerMetric(this.shopPageCacheEvents);
    this.registry.registerMetric(this.shopPageProductsReturned);
    this.registry.registerMetric(this.shopPageRateLimited);
    this.registry.registerMetric(this.checkoutTraceQueryCapReached);
  }

  observeAuthStep(flow: string, step: string, durationMs: number): void {
    this.authStepDuration.observe({ flow, step }, durationMs / 1000);
  }

  recordAuthAccessMissing(): void {
    this.authAccessMissing.inc();
  }

  recordAuthAccessInvalid(reason: string): void {
    this.authAccessInvalid.inc({ reason });
  }

  recordAuthSessionValidated(): void {
    this.authSessionValidated.inc();
  }

  recordAuthRefreshRace(reason: string): void {
    this.authRefreshRace.inc({ reason });
  }

  recordAuthRefreshInvalid(reason: string): void {
    this.authRefreshInvalid.inc({ reason });
  }

  observeAuthRefreshLatency(durationMs: number): void {
    this.authRefreshLatency.observe(durationMs / 1000);
  }

  recordOtpIdempotentSend(): void {
    this.phoneOtpIdempotentSends.inc();
  }

  recordOtpBlocked(kind: string): void {
    this.otpAbuse.inc({ kind });
  }

  recordOtpSent(provider: string, outcome: string): void {
    this.phoneOtpSendTotal.inc({ provider, outcome });
  }

  recordOtpVerified(provider: string): void {
    this.phoneOtpVerifyTotal.inc({ provider, outcome: "success" });
  }

  recordOtpProviderFailure(provider: string, reason: string): void {
    this.phoneOtpProviderFailures.inc({ provider, reason });
    this.phoneOtpSendTotal.inc({ provider, outcome: "provider_failed" });
  }

  recordOtpProofFailed(reason: string): void {
    this.phoneOtpProofFailures.inc({ reason });
  }

  setPhoneOtpCircuitState(provider: string, state: "closed" | "half_open" | "open"): void {
    this.phoneOtpCircuitState.set({ provider }, state === "open" ? 2 : state === "half_open" ? 1 : 0);
  }

  observeUploadStage(purpose: string, stage: string, format: string, durationMs: number): void {
    this.uploadStageDuration.observe({ purpose, stage, format }, durationMs / 1000);
  }

  recordUploadRequest(purpose: string, status: string, stage: string, format: string): void {
    this.uploadRequests.inc({ purpose, status, stage, format });
  }

  recordUploadFailure(purpose: string, category: string): void {
    this.uploadFailures.inc({ purpose, category });
  }

  recordUploadCleanupFailed(purpose: string, outcome: string): void {
    this.uploadCleanupFailed.inc({ purpose, outcome });
  }

  recordUploadBytes(purpose: string, format: string, rendition: string, bytes: number): void {
    this.uploadBytes.inc({ purpose, format, rendition }, bytes);
  }

  recordCloudinaryRequest(operation: string, status: string, durationMs: number): void {
    this.cloudinaryRequests.inc({ operation, status });
    this.cloudinaryDuration.observe({ operation }, durationMs / 1000);
  }

  setUploadCircuitState(provider: string, state: "closed" | "half_open" | "open"): void {
    this.uploadCircuitState.set({ provider }, state === "open" ? 2 : state === "half_open" ? 1 : 0);
  }

  setUploadOrphans(purpose: string, ageBucket: string, count: number): void {
    this.uploadOrphans.set({ purpose, age_bucket: ageBucket }, count);
  }

  setUploadOrphanOriginals(ageBucket: string, count: number): void {
    this.uploadOrphanOriginals.set({ age_bucket: ageBucket }, count);
  }

  recordI18nFallback(input: { locale: string; namespace: string; key: string; routeTemplate: string }): void {
    this.i18nFallbacks.inc({
      key: input.key,
      locale: input.locale,
      namespace: input.namespace,
      route_template: input.routeTemplate
    });
  }

  recordShopPageRequest(input: { endpoint: string; status: string; cache: string; durationMs: number }): void {
    this.shopPageRequests.inc({
      cache: input.cache,
      endpoint: input.endpoint,
      status: input.status
    });
    this.shopPageDuration.observe({
      cache: input.cache,
      endpoint: input.endpoint
    }, input.durationMs / 1000);
  }

  recordShopPageCacheEvent(event: string, keyFamily: string): void {
    this.shopPageCacheEvents.inc({ event, key_family: keyFamily });
  }

  observeShopPageProductsReturned(count: number): void {
    this.shopPageProductsReturned.observe(count);
  }

  recordShopPageRateLimited(endpoint: string): void {
    this.shopPageRateLimited.inc({ endpoint });
  }

  recordCheckoutTraceQueryCapReached(): void {
    this.checkoutTraceQueryCapReached.inc();
  }

  metrics() {
    return this.registry.metrics();
  }

  contentType() {
    return this.registry.contentType;
  }
}
