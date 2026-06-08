import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import os from "node:os";
import path from "node:path";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");
const apiProxyOrigin = resolveApiProxyOrigin();

const devOrigins = [
  "127.0.0.1",
  "192.168.*.*",
  "10.*.*.*",
  "172.*.*.*",
  ...localNetworkHosts()
];

const nextConfig: NextConfig = {
  allowedDevOrigins: devOrigins,
  devIndicators: false,
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
  outputFileTracingRoot: path.resolve(process.cwd()),
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${apiProxyOrigin}/api/:path*`
      }
    ];
  },
  images: {
    deviceSizes: [360, 414, 640, 768, 1024, 1280, 1536],
    formats: ["image/avif", "image/webp"],
    imageSizes: [32, 48, 64, 96, 160, 240, 320, 400, 600],
    minimumCacheTTL: 86_400,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "res.cloudinary.com"
      },
      {
        protocol: "https",
        hostname: "images.unsplash.com"
      }
    ]
  }
};

export default withNextIntl(nextConfig);

function resolveApiProxyOrigin() {
  const configured = firstConfiguredValue(
    process.env.API_PROXY_URL,
    process.env.BACKEND_URL,
    process.env.INTERNAL_API_URL,
    absoluteApiOrigin(process.env.NEXT_PUBLIC_API_URL)
  );

  if (configured) {
    return productionSafeApiProxyOrigin(configured);
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Production API proxy is not configured. Set API_PROXY_URL, BACKEND_URL, INTERNAL_API_URL, or an absolute NEXT_PUBLIC_API_URL."
    );
  }

  return "http://127.0.0.1:4000";
}

function productionSafeApiProxyOrigin(value: string) {
  const origin = stripApiSuffix(value);

  if (!/^https?:\/\//i.test(origin)) {
    throw new Error("API proxy URL must be an absolute http(s) URL.");
  }

  if (
    process.env.NODE_ENV === "production" &&
    isLoopbackUrl(origin) &&
    isHostedProductionBuild()
  ) {
    throw new Error(
      "Production API proxy cannot point to localhost. Set API_PROXY_URL, BACKEND_URL, INTERNAL_API_URL, or NEXT_PUBLIC_API_URL to the deployed backend URL."
    );
  }

  return origin;
}

function firstConfiguredValue(...values: Array<string | undefined>) {
  return values.map((value) => value?.trim()).find((value): value is string => Boolean(value));
}

function absoluteApiOrigin(value: string | undefined) {
  const raw = value?.trim();
  if (!raw || !/^https?:\/\//i.test(raw)) {
    return undefined;
  }

  try {
    return new URL(raw).origin;
  } catch {
    return undefined;
  }
}

function stripApiSuffix(value: string) {
  return value.replace(/\/$/, "").replace(/\/api$/i, "");
}

function isLoopbackUrl(value: string) {
  try {
    const hostname = new URL(value).hostname;
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

function isHostedProductionBuild() {
  return [
    process.env.CI,
    process.env.VERCEL,
    process.env.NETLIFY,
    process.env.RENDER,
    process.env.RAILWAY_ENVIRONMENT,
    process.env.FLY_APP_NAME,
    process.env.AMPLIFY_APP_ID
  ].some(isTruthyEnv);
}

function isTruthyEnv(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  return Boolean(normalized && !["0", "false", "no", "off"].includes(normalized));
}

function localNetworkHosts() {
  return Object.values(os.networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .filter((entry) => entry.family === "IPv4" && !entry.internal)
    .map((entry) => entry.address);
}
