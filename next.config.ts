import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* VibeHub static hosting exports to out/; default remains the standalone server */
  output: process.env.VIBEHUB_STATIC ? "export" : "standalone",
  // VibeHub hosts works under a sub-path, so exported assets must use relative URLs
  assetPrefix: process.env.VIBEHUB_STATIC ? "./" : undefined,
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // keep the bottom-left corner clean for the FPS badge
  devIndicators: false,
};

export default nextConfig;
