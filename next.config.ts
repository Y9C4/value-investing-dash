import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Gzip the HTML and RSC payloads. Vercel compresses at its edge regardless,
  // so this is what makes a self-hosted or preview deployment behave the same.
  compress: true,
  // Nothing is gained by announcing the framework and version in a header.
  poweredByHeader: false,
};

export default nextConfig;
