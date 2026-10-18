import { resolve } from "node:path";

import { migrate } from "drizzle-orm/libsql/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabase, type DatabaseHandle } from "@/db/client";
import { runSchemaChecks } from "@/db/verify";

import { cleanupTempDirectory, createTempDatabasePath } from "./helpers";

/**
 * Integration test: apply the committed migrations to a throwaway libSQL file,
 * then run the exact same integrity probe `npm run db:smoke` runs — FK
 * enforcement, append-only triggers, CHECK constraints, FTS sync, unique
 * indexes — so schema regressions fail CI, not production.
 */
describe("migrations on a fresh database", () => {
  let directory: string;
  let handle: DatabaseHandle;

  beforeAll(async () => {
    const target = createTempDatabasePath("medical-store-schema");
    directory = target.directory;
    handle = createDatabase(target.url);
    await migrate(handle.db, { migrationsFolder: resolve("drizzle") });
  });

  afterAll(() => {
    handle.client.close();
    cleanupTempDirectory(directory);
  });

  it("records the applied migration journal", async () => {
    const applied = await handle.client.execute("select count(*) as n from __drizzle_migrations");
    expect(Number(applied.rows[0]?.n)).toBeGreaterThan(0);
  });

  it("creates the core objects including FTS and append-only triggers", async () => {
    const objects = await handle.client.execute(
      "select type, name from sqlite_master where name in ('products', 'products_fts', 'batches', 'stock_movements', 'audit_log', 'controlled_register', 'rate_limits')",
    );
    const found = new Set(objects.rows.map((row) => String(row.name)));
    for (const name of [
      "products",
      "products_fts",
      "batches",
      "stock_movements",
      "audit_log",
      "controlled_register",
      "rate_limits",
    ]) {
      expect(found.has(name), `missing object: ${name}`).toBe(true);
    }

    const triggers = await handle.client.execute(
      "select name from sqlite_master where type = 'trigger' and name like '%append_only%'",
    );
    expect(triggers.rows.length).toBeGreaterThanOrEqual(6);
  });

  it("passes every schema integrity probe", async () => {
    const results = await runSchemaChecks(handle.client, { runId: "vitest" });
    const failed = results.filter((result) => !result.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    // The probe set covers FKs, triggers, CHECKS, FTS and unique indexes; if a
    // probe silently disappears, this test should fail loudly.
    expect(results.length).toBeGreaterThanOrEqual(35);
  });
});
