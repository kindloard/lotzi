import type { DealProduct, Shop } from "../shops-api";

const SERVER_FETCH_TIMEOUT_MS = 2_500;

export async function getShopsForLanding(): Promise<Shop[]> {
  return serverFetchJson<Shop[]>("/v1/shops", []);
}

export async function getDealProductsForLanding(): Promise<DealProduct[]> {
  return serverFetchJson<DealProduct[]>("/v1/shops/products", []);
}

async function serverFetchJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const response = await fetch(apiUrl(path), {
      cache: "no-store",
      headers: {
        accept: "application/json"
      },
      signal: AbortSignal.timeout(SERVER_FETCH_TIMEOUT_MS)
    });

    if (!response.ok) {
      return fallback;
    }

    return (await response.json()) as T;
  } catch {
    return fallback;
  }
}

function apiUrl(path: string) {
  const rawBase =
    process.env.INTERNAL_API_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    "http://127.0.0.1:4000";

  const absoluteBase = rawBase.startsWith("/")
    ? "http://127.0.0.1:4000"
    : rawBase.replace(/\/$/, "");
  const apiBase = absoluteBase.endsWith("/api") ? absoluteBase : `${absoluteBase}/api`;

  return `${apiBase}${path}`;
}
