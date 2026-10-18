import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

import { createDatabase } from "../src/db/client";
import type { SessionUser } from "../src/lib/auth/session";
import { addDaysIso, todayIso } from "../src/lib/dates";
import { DomainError } from "../src/lib/errors";
import { newId } from "../src/lib/ids";
import { checkout, type CheckoutInput } from "../src/lib/sales-mutations";
import { openShift } from "../src/lib/shift-mutations";
import { loadScriptEnv } from "./load-env";

loadScriptEnv();

/**
 * Remote concurrent-checkout probe (spec §6.1 M2 step 7): races two checkouts
 * for the last unit of stock on a throwaway Turso database and asserts exactly
 * one wins while the loser gets STOCK_CHANGED. Also replays the winner's
 * idempotency key and asserts no second sale row is written.
 *
 *   TURSO_DATABASE_URL=libsql://throwaway.turso.io \
 *   TURSO_AUTH_TOKEN=... \
 *   npx tsx scripts/concurrency-check.ts --yes
 *
 * Requires a remote, disposable database — fixtures (sales, movements, audit)
 * are append-only and cannot be cleaned afterwards.
 */
async function main(): Promise<void> {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url || url.startsWith("file:") || !authToken) {
    console.error(
      "concurrency-check needs remote TURSO_DATABASE_URL + TURSO_AUTH_TOKEN (throwaway DB).",
    );
    process.exitCode = 1;
    return;
  }
  if (!process.argv.includes("--yes")) {
    console.error("Re-run with `--yes` — this writes permanent rows to the target database.");
    process.exitCode = 1;
    return;
  }

  const handle = createDatabase(url, authToken);
  const run = `chk-${newId().slice(0, 8)}`;
  const today = todayIso();
  const cashier: SessionUser = {
    id: `u-${run}`,
    name: "Concurrency check",
    email: `${run}@smoke.test`,
    role: "cashier",
    branchId: `br-${run}`,
  };
  const productId = `p-${run}`;
  const unitId = `u-${run}-unit`;

  try {
    await migrate(drizzle(handle.client), { migrationsFolder: "./drizzle" });

    const now = Date.now();
    await handle.client.batch(
      [
        {
          sql: "insert into branches (id, name, created_at, updated_at) values (?,?,?,?)",
          args: [cashier.branchId, "Concurrency check", now, now],
        },
        {
          sql: `insert into users (id, name, email, role, branch_id, active, created_at, updated_at)
                values (?,?,?,?,?,1,?,?)`,
          args: [cashier.id, cashier.name, cashier.email, "cashier", cashier.branchId, now, now],
        },
        {
          sql: `insert into products (id, sku, name, base_unit, requires_rx, controlled_schedule,
                  cold_chain, sellable_loose, reorder_level, active, created_at, updated_at)
                values (?,?,?,?,0,null,0,0,0,1,?,?)`,
          args: [productId, `SKU-${run}`, "Concurrency test item", "tablet", now, now],
        },
        {
          sql: `insert into product_units (id, product_id, name, factor_to_base, is_default_sale, created_at, updated_at)
                values (?,?,?,1,1,?,?)`,
          args: [unitId, productId, "tablet", now, now],
        },
        {
          sql: `insert into product_prices (id, product_id, unit_id, price, effective_from, created_at, updated_at)
                values (?,?,?,?,?,?,?)`,
          args: [`pr-${run}`, productId, unitId, 100, now, now, now],
        },
        {
          sql: `insert into batches (id, product_id, branch_id, batch_no, expiry_date, cost_per_base_unit,
                  qty_received, qty_remaining, received_at, created_at, updated_at)
                values (?,?,?,?,?,10,1,1,?,?,?)`,
          args: [
            `b-${run}`,
            productId,
            cashier.branchId,
            `BN-${run}`,
            addDaysIso(today, 180),
            now,
            now,
            now,
          ],
        },
      ],
      "write",
    );
    await openShift(handle, cashier, { openingFloatMinor: 0 });

    const input: CheckoutInput = {
      lines: [{ productId, unitId, qtyBase: 1 }],
      payments: [{ method: "cash", amountMinor: 100 }],
    };

    const [first, second] = await Promise.allSettled([
      checkout(handle, cashier, input, `idem-${run}-a`),
      checkout(handle, cashier, input, `idem-${run}-b`),
    ]);

    const winners = [first, second].filter((r) => r.status === "fulfilled");
    const losers = [first, second].filter((r) => r.status === "rejected");
    const stockChanged =
      losers.length === 1 &&
      losers[0].reason instanceof DomainError &&
      losers[0].reason.code === "STOCK_CHANGED";
    if (winners.length !== 1 || !stockChanged) {
      console.error(
        `FAIL: expected exactly one winner + one STOCK_CHANGED; got ` +
          `${winners.length} winner(s), losers: ${losers.map((l) => String(l.reason)).join(" | ")}`,
      );
      process.exitCode = 1;
      return;
    }
    const winnerKey = first.status === "fulfilled" ? `idem-${run}-a` : `idem-${run}-b`;
    console.log("PASS: exactly one concurrent checkout won; the loser got STOCK_CHANGED.");

    // Idempotent replay: the same key must return the stored receipt, not write again.
    const replay = await checkout(handle, cashier, input, winnerKey);
    const count = await handle.client.execute({
      sql: "select count(*) as n from sales where branch_id = ?",
      args: [cashier.branchId],
    });
    if (
      Number(count.rows[0].n) !== 1 ||
      replay.saleId !== (winners[0] as PromiseFulfilledResult<typeof replay>).value.saleId
    ) {
      console.error("FAIL: idempotent replay did not return the original sale.");
      process.exitCode = 1;
      return;
    }
    console.log("PASS: replayed idempotency key returned the stored receipt (no second sale).");
    console.log(
      `Done — receipt #${replay.receiptNo}. Remove the throwaway database when finished.`,
    );
  } finally {
    handle.client.close();
  }
}

main().catch((error: unknown) => {
  console.error("Concurrency check failed:", error);
  process.exitCode = 1;
});
