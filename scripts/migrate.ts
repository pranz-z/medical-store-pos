import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

import { loadScriptEnv } from "./load-env";

loadScriptEnv();

/**
 * Applies Drizzle migrations to the database configured by TURSO_DATABASE_URL.
 * Run in CI/deploy before traffic shifts — never inside serverless functions
 * (spec §4.3.5).
 */
async function main(): Promise<void> {
  const url = process.env.TURSO_DATABASE_URL ?? "file:local.db";
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (url.startsWith("file:")) {
    const filePath = resolve(url.slice("file:".length));
    mkdirSync(dirname(filePath), { recursive: true });
  }

  const client = createClient({ url, ...(authToken ? { authToken } : {}) });
  const db = drizzle(client);

  try {
    console.log(`Applying migrations to ${url} ...`);
    await migrate(db, { migrationsFolder: "./drizzle" });
    console.log("Migrations applied successfully.");
  } finally {
    client.close();
  }
}

main().catch((error: unknown) => {
  console.error("Migration failed:", error);
  process.exitCode = 1;
});
