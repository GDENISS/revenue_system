import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit a self-contained server bundle so the Docker image only needs
  // .next/standalone + .next/static + public (no full node_modules).
  output: "standalone",
};

export default nextConfig;
