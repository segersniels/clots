import path from "node:path";

import type { NextConfig } from "next";

export default {
  output: "export",
  // The page uses the clot drawing and the Allo font from other workspaces of the repository.
  transpilePackages: ["@clots/character"],
  turbopack: { root: path.join(import.meta.dirname, "../..") },
} satisfies NextConfig;
