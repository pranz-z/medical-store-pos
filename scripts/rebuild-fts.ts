import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { createClient } from "@libsql/client";

import { loadScriptEnv } from "./load-env";

loadScriptEnv();

/**
 * Rebuilds the `products_fts` full-text index from the `products` table.
 *
 * The index is normally maintained by the insert/update/delete triggers created
 * in the initial migration, so this is a maintenance tool: run it after a bulk
 * import that wrote to `products` with triggers disabled, or whenever the index
 * is suspected to have drifted. Both statements run in one write transaction.
 *
 * Usage: npm run db:fts:rebuild   (targets TURSO_DATABASE_URL)
 */
async function main(): Promise<void> {
  const url = process.env.TURSO_DATABASE_URL ?? "file:local.db";
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (url.startsWith("file:")) {
    mkdirSync(dirname(resolve(url.slice("file:".length))), { recursive: true });
  }

  const client = createClient({ url, ...(authToken ? { authToken } : {}) });

  try {
    const products = await client.execute("select count(*) as c from products");
    const before = await client.execute("select count(*) as c from products_fts");

    await client.batch(
      [
        { sql: "delete from products_fts", args: [] },
        {
          sql: "insert into products_fts (name, generic_name, sku, product_id) select name, generic_name, sku, id from products",
          args: [],
        },
      ],
      "write",
    );

    const after = await client.execute("select count(*) as c from products_fts");
    console.log(
      `Rebuilt products_fts on ${url}: ${before.rows[0].c} -> ${after.rows[0].c} indexed rows for ${products.rows[0].c} products.`,
    );
  } finally {
    client.close();
  }
}

main().catch((error: unknown) => {
  console.error("FTS rebuild failed:", error);
  process.exitCode = 1;
});
