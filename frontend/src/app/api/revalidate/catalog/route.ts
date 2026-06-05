import { revalidateTag } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

export const dynamic = "force-dynamic";

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 120;
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();
const TAG_PATTERNS = [
  /^shop-detail:\d{6}$/,
  /^shop-catalog:\d{6}(?::[a-f0-9]{16})?$/,
  /^shop-pdp:[0-9a-f]{32}$/
];

type CatalogRevalidationPayload = {
  invalidateCatalog?: boolean;
  invalidateDetail?: boolean;
  invalidatePdp?: boolean;
  productPublicIds?: string[];
  storePublicId?: string;
  tags?: string[];
};

export async function POST(request: NextRequest) {
  const headers = noStoreHeaders();
  const clientKey = clientIdentity(request);
  if (!consumeRateLimit(clientKey)) {
    return NextResponse.json({ error: "rate_limited" }, { headers, status: 429 });
  }

  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { headers, status: 401 });
  }

  let payload: CatalogRevalidationPayload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { headers, status: 400 });
  }

  const tags = revalidationTags(payload);
  if (!tags.length) {
    return NextResponse.json({ error: "no_valid_tags" }, { headers, status: 400 });
  }

  for (const tag of tags) {
    revalidateTag(tag);
  }

  return NextResponse.json({ revalidated: tags }, { headers });
}

function noStoreHeaders() {
  return {
    "Cache-Control": "no-store, max-age=0, must-revalidate"
  };
}

function isAuthorized(request: NextRequest) {
  const expected = process.env.CATALOG_REVALIDATE_SECRET;
  const received = request.headers.get("x-revalidate-secret") ?? "";
  if (!expected || !received) {
    return false;
  }

  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer);
}

function revalidationTags(payload: CatalogRevalidationPayload) {
  const tags = new Set<string>();
  const storePublicId = normalizedStorePublicId(payload.storePublicId);
  if (storePublicId && payload.invalidateDetail) {
    tags.add(`shop-detail:${storePublicId}`);
  }
  if (storePublicId && payload.invalidateCatalog) {
    tags.add(`shop-catalog:${storePublicId}`);
  }
  if (payload.invalidatePdp) {
    for (const productPublicId of payload.productPublicIds ?? []) {
      const normalized = normalizedProductPublicId(productPublicId);
      if (normalized) {
        tags.add(`shop-pdp:${normalized}`);
      }
    }
  }
  for (const tag of payload.tags ?? []) {
    if (isAllowedTag(tag)) {
      tags.add(tag);
    }
  }
  return Array.from(tags).filter(isAllowedTag);
}

function isAllowedTag(tag: string) {
  return TAG_PATTERNS.some((pattern) => pattern.test(tag));
}

function normalizedStorePublicId(value: unknown) {
  return typeof value === "string" && /^\d{6}$/.test(value) ? value : null;
}

function normalizedProductPublicId(value: unknown) {
  return typeof value === "string" && /^[0-9a-f]{32}$/i.test(value) ? value.toLowerCase() : null;
}

function consumeRateLimit(key: string) {
  const now = Date.now();
  const current = rateLimitBuckets.get(key);
  if (!current || current.resetAt <= now) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (current.count >= RATE_LIMIT_MAX_REQUESTS) {
    return false;
  }
  current.count += 1;
  return true;
}

function clientIdentity(request: NextRequest) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}
