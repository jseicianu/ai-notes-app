import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "pdf-parse",
    "@extractus/article-extractor",
    "ajv",
  ],
};

export default nextConfig;
