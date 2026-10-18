import { resolve } from "node:path";

import { migrate } from "drizzle-orm/libsql/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabase, type DatabaseHandle } from "@/db/client";
import { seedDatabase, type SeedSummary } from "@/db/seed";
import { todayIso } from "@/lib/dates";

import { cleanupTempDirectory, createTempDatabasePath } from "./helpers";

/**
 * Integration test: the demo seed must land on a freshly migrated database and
 * must refuse to run twice (dev safety: `npm run db:reset` is the rebuild path).
 */
describe("seed on a freshly migrated database", () => {
  let directory: string;
  let handle: DatabaseHandle;
  let summary: SeedSummary;

  beforeAll(async () => {
    const target = createTempDatabasePath("medical-store-seed");
    directory = target.directory;
    handle = createDatabase(target.url);
    await migrate(handle.db, { migrationsFolder: resolve("drizzle") });
    summary = await seedDatabase(handle);
  });

  afterAll(() => {
    handle.client.close();
    cleanupTempDirectory(directory);
  });

  it("seeds the documented demo dataset", () => {
    expect(summary).toEqual({
      users: 5,
      taxClasses: 2,
      categories: 11,
      suppliers: 3,
      products: 56,
      productUnits: 109,
      barcodes: 109,
      batches: 58,
      stockMovements: 58,
      controlledRegister: 3,
      settings: 10,
    });
  });

  it("includes expired and near-expiry batches for dashboard/FEFO demos", async () => {
    const today = todayIso("Asia/Manila");
    const expired = await handle.client.execute({
      sql: "select count(*) as n from batches where qty_remaining > 0 and expiry_date < ?",
      args: [today],
    });
    expect(Number(expired.rows[0]?.n)).toBeGreaterThan(0);
  });

  it("indexes seeded products in the FTS table", async () => {
    const matches = await handle.client.execute(
      "select count(*) as n from products_fts where products_fts match 'paracetamol'",
    );
    expect(Number(matches.rows[0]?.n)).toBeGreaterThan(0);
  });

  it("refuses to seed a database that already has data", async () => {
    await expect(seedDatabase(handle)).rejects.toThrow(/already contains data/i);
  });
});
