import { defineConfig } from "drizzle-kit";

import { loadScriptEnv } from "./scripts/load-env";

loadScriptEnv();

/**
 * Drizzle Kit config.
 *
 * Local development targets `file:local.db`; remote environments supply
 * TURSO_DATABASE_URL/TURSO_AUTH_TOKEN from the environment (Vercel env vars).
 * Migrations are applied by `npm run db:migrate` in CI/deploy — never at runtime
 * inside serverless functions (spec §4.3.5).
 */
export default defineConfig({
  dialect: "turso",
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.TURSO_DATABASE_URL ?? "file:local.db",
    authToken: process.env.TURSO_AUTH_TOKEN,
  },
  verbose: true,
  strict: true,
});
