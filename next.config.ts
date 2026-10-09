import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Node 向けの大きなパッケージはバンドルせず実行時に解決する
  serverExternalPackages: ["googleapis", "pg"],
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
