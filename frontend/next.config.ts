import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import os from "node:os";
import path from "node:path";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");
const apiProxyOrigin = (process.env.API_PROXY_URL ?? process.env.BACKEND_URL ?? "http://127.0.0.1:4000").replace(/\/$/, "");

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

function localNetworkHosts() {
  return Object.values(os.networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .filter((entry) => entry.family === "IPv4" && !entry.internal)
    .map((entry) => entry.address);
}
