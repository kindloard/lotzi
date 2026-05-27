import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import os from "node:os";
import path from "node:path";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

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
        destination: "http://127.0.0.1:4000/api/:path*"
      }
    ];
  },
  images: {
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
