import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // keep the bottom-left corner clean for the FPS badge
  devIndicators: false,
};

export default nextConfig;
