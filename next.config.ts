import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfkit reads its font metrics from its own package folder at runtime.
  serverExternalPackages: ["better-sqlite3", "pdfkit"],
  // The data/ files are read at runtime; make sure standalone/serverless traces include them.
  outputFileTracingIncludes: { "/**": ["./data/**"] },
};

export default nextConfig;
