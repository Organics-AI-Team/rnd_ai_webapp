import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */

  // Enable standalone output for Docker
  // This creates a minimal server.js file with all dependencies bundled
  // Reduces image size and improves cold start performance
  output: 'standalone',
};

export default nextConfig;
