import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

import { createDatabase } from "../src/db/client";
import { seedDatabase } from "../src/db/seed";
import { ensureLocalDirectory, resolveDbTarget } from "./db-target";

/**
 * Rebuilds the target database from scratch: drops every object, re-applies
 * the migrations and re-seeds.
 *
 * This is the only way to "clean" a database containing append-only tables —
 * UPDATE/DELETE triggers block row-level cleanup by design. Same `--force`
 * guard as the seed script for non-local targets.
 */
async function main(): Promise<void> {
  const target = resolveDbTarget("reset");
  ensureLocalDirectory(target.url);

  const client = createClient({
    url: target.url,
    ...(target.authToken ? { authToken: target.authToken } : {}),
  });

  try {
    // FK enforcement would block dropping parent tables (implicit DELETE check);
    // the drop pass is intentionally order-independent.
    await client.execute("pragma foreign_keys = off");

    const objects = await client.execute(
      "select type, name from sqlite_master where name not like 'sqlite_%' and type in ('trigger', 'index', 'table')",
    );

    let dropped = 0;
    const failures: string[] = [];
    // Order: triggers, indexes, then tables. FTS shadow tables can only be
    // removed via their virtual table, so failures are tolerated and rechecked.
    for (const type of ["trigger", "index", "table"] as const) {
      for (const row of objects.rows.filter((r) => r.type === type)) {
        const name = String(row.name);
        try {
          await client.execute(`drop ${type} if exists "${name.replaceAll('"', '""')}"`);
          dropped += 1;
        } catch (error) {
          failures.push(
            `${type} ${name}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }

    const remaining = await client.execute(
      "select count(*) as c from sqlite_master where name not like 'sqlite_%' and type = 'table'",
    );
    const remainingCount = Number(remaining.rows[0]?.c ?? 0);
    if (remainingCount > 0) {
      throw new Error(
        `Refusing to continue: ${remainingCount} table(s) left after the drop pass:\n${failures.join("\n")}`,
      );
    }
    console.log(`Dropped ${dropped} objects (${failures.length} tolerated shadow-table errors).`);
    console.log("Re-applying migrations ...");
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: "./drizzle" });
  } finally {
    client.close();
  }

  const handle = createDatabase(target.url, target.authToken);
  try {
    console.log("Seeding ...");
    const summary = await seedDatabase(handle);
    console.log("Reset complete:", summary);
  } finally {
    handle.client.close();
  }
}

main().catch((error: unknown) => {
  console.error("Reset failed:", error);
  process.exitCode = 1;
});
