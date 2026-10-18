import { createDatabase } from "../src/db/client";
import { seedDatabase } from "../src/db/seed";
import { ensureLocalDirectory, resolveDbTarget } from "./db-target";

/**
 * Seeds a fresh database with demo data.
 *
 * Refuses to seed a non-local database unless `--force` is passed, because the
 * seed writes demo accounts (credentials documented in
 * `src/db/seed-credentials.ts`) and cannot be undone — the append-only tables
 * reject deletes, so a cleanup means `npm run db:reset` or dropping the DB.
 */
async function main(): Promise<void> {
  const target = resolveDbTarget("seed");
  ensureLocalDirectory(target.url);

  const handle = createDatabase(target.url, target.authToken);
  try {
    console.log(`Seeding ${target.url} ...`);
    const summary = await seedDatabase(handle);
    console.log("Seed complete:", summary);
    if (!target.isLocal) {
      console.warn(
        "NOTE: this was a remote database — demo credentials are now live there. Reset it when done.",
      );
    }
  } finally {
    handle.client.close();
  }
}

main().catch((error: unknown) => {
  console.error("Seed failed:", error);
  process.exitCode = 1;
});
