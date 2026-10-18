import { config } from "dotenv";

/**
 * Loads `.env.local` then `.env` (first value wins) for scripts and tools that
 * run outside the Next.js runtime (drizzle-kit, migrate/seed/reset scripts).
 * Next.js itself loads those files automatically for the app.
 */
export function loadScriptEnv(): void {
  config({ path: [".env.local", ".env"], quiet: true });
}
