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
    return stripApiSuffix(configured);
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Production API proxy is not configured. Set API_PROXY_URL, BACKEND_URL, INTERNAL_API_URL, or an absolute NEXT_PUBLIC_API_URL."
    );
  }

  return "http://127.0.0.1:4000";
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

function localNetworkHosts() {
  return Object.values(os.networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .filter((entry) => entry.family === "IPv4" && !entry.internal)
    .map((entry) => entry.address);
}
