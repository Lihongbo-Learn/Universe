import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* VibeHub static hosting exports to out/; default remains the standalone server */
  output: process.env.VIBEHUB_STATIC ? "export" : "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // keep the bottom-left corner clean for the FPS badge
  devIndicators: false,
};

export default nextConfig;
