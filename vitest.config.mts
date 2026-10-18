import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    // Integration tests migrate and seed a throwaway libSQL file; give them room
    // on cold CI machines but keep the suite snappy.
    testTimeout: 30_000,
    env: {
      // Placeholder values — unit/integration tests never talk to a real
      // database or service. Integration tests use their own temp file DBs.
      AUTH_SECRET: "vitest-placeholder-secret-00000000000000000000",
      APP_TIMEZONE: "Asia/Manila",
      APP_CURRENCY: "PHP",
    },
  },
});
