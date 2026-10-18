import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // NOTE: Cache Components (`cacheComponents: true`) is intentionally left off for M0.
  // This app is fully session/data-dependent; the classic rendering model keeps
  // cookie-based auth straightforward. Revisit for report pages in later milestones.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
