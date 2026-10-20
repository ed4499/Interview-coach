import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  // The data/ files are read at runtime; make sure standalone/serverless traces include them.
  outputFileTracingIncludes: { "/**": ["./data/**"] },
};

export default nextConfig;
