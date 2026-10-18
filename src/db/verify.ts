import type { Client, InValue } from "@libsql/client";

/**
 * Schema-level integrity probe.
 *
 * Verifies the invariants the migration promises — FK enforcement, append-only
 * triggers, CHECK constraints, the FTS5 index sync and index uniqueness — by
 * writing throwaway fixtures into the connected database. Used by
 * `npm run db:smoke` (remote/Turso) and by the integration test suite (local
 * libSQL), so both run exactly the same checks.
 *
 * The probe never deletes its fixtures (the append-only tables reject deletes),
 * which is why `runId` scopes every id: repeated runs can share one database
 * without colliding. Point it at a throwaway database.
 */

export interface SchemaCheckResult {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface SchemaCheckOptions {
  /** Unique per run, e.g. `newId()`. Prefixed onto every fixture id. */
  runId: string;
}

export async function runSchemaChecks(
  client: Client,
  options: SchemaCheckOptions,
): Promise<SchemaCheckResult[]> {
  const results: SchemaCheckResult[] = [];
  const runId = options.runId.toLowerCase();
  const id = (suffix: string) => `chk_${runId}_${suffix}`;
  const now = Date.now();

  const run = (sql: string, args: InValue[] = []) => client.execute({ sql, args });
  const ok = (name: string, passed: boolean, detail?: string) => {
    results.push(detail === undefined ? { name, ok: passed } : { name, ok: passed, detail });
  };
  const expectRejected = async (name: string, sql: string, args: InValue[] = []) => {
    try {
      await run(sql, args);
      ok(name, false, "statement unexpectedly succeeded");
    } catch (error) {
      ok(name, true, firstLine(error));
    }
  };

  // ---------------------------------------------------------------- FK pragma
  const fkBefore = await readPragma(client, "foreign_keys");
  if (fkBefore !== 1) {
    await run("pragma foreign_keys = on");
  }
  const fkAfter = await readPragma(client, "foreign_keys");
  ok(
    "PRAGMA foreign_keys is enforced",
    fkAfter === 1,
    fkBefore === 1
      ? undefined
      : `was ${fkBefore} on connect; ${fkAfter === 1 ? "enabled for this session" : "could not enable"}`,
  );

  // ---------------------------------------------------------------- fixtures
  await run("insert into branches (id, name, created_at, updated_at) values (?,?,?,?)", [
    id("br"),
    `Check Branch ${runId}`,
    now,
    now,
  ]);
  await run(
    "insert into users (id, name, email, role, created_at, updated_at) values (?,?,?,?,?,?)",
    [id("u1"), "Check Owner", `check-owner-${runId}@example.com`, "owner", now, now],
  );
  await run(
    "insert into users (id, name, email, role, created_at, updated_at) values (?,?,?,?,?,?)",
    [id("u2"), "Check Cashier", `Check-CASHIER-${runId}@Example.com`, "cashier", now, now],
  );
  await run(
    "insert into products (id, sku, name, generic_name, base_unit, created_at, updated_at) values (?,?,?,?,?,?,?)",
    [id("p1"), `SKU-${runId}`, `Zzzitem ${runId}`, "Paracetamol", "tablet", now, now],
  );
  await run(
    "insert into products (id, sku, name, base_unit, created_at, updated_at) values (?,?,?,?,?,?)",
    [id("p2"), `SKU-DEL-${runId}`, `Qlonely ${runId}`, "bottle", now, now],
  );
  await run(
    "insert into product_units (id, product_id, name, factor_to_base, created_at, updated_at) values (?,?,?,?,?,?)",
    [id("pu"), id("p1"), "tablet", 1, now, now],
  );
  await run("insert into suppliers (id, name, created_at, updated_at) values (?,?,?,?)", [
    id("sup"),
    `Check Supplier ${runId}`,
    now,
    now,
  ]);
  await run(
    "insert into shifts (id, user_id, branch_id, opened_at, created_at, updated_at) values (?,?,?,?,?,?)",
    [id("sh"), id("u1"), id("br"), now, now, now],
  );
  await run(
    "insert into sales (id, receipt_no, branch_id, cashier_id, idempotency_key, subtotal, total, created_at, updated_at) values (?,?,?,?,?,?,?,?,?)",
    [id("s"), 1, id("br"), id("u1"), `idem-${runId}`, 1000, 1000, now, now],
  );

  // ------------------------------------------------------------------- FKs
  await expectRejected(
    "FK violation rejected (batch with unknown product)",
    "insert into batches (id, product_id, branch_id, batch_no, expiry_date, cost_per_base_unit, qty_received, qty_remaining, received_at, created_at, updated_at) values (?,?,?,?,?,?,?,?,?,?,?)",
    [id("bad"), "ghost-product", id("br"), "B", "2026-12-31", 1, 1, 1, now, now, now],
  );

  // ------------------------------------------- batches: unique batch identity
  const insertBatch = (batchId: string, batchNo: string, expiryDate: string) =>
    run(
      "insert into batches (id, product_id, branch_id, batch_no, expiry_date, cost_per_base_unit, qty_received, qty_remaining, received_at, created_at, updated_at) values (?,?,?,?,?,?,?,?,?,?,?)",
      [batchId, id("p1"), id("br"), batchNo, expiryDate, 250, 100, 100, now, now, now],
    );
  await insertBatch(id("b1"), `B-${runId}`, "2026-12-31");
  await expectRejected(
    "duplicate batch (branch, product, batch_no, expiry) rejected",
    "insert into batches (id, product_id, branch_id, batch_no, expiry_date, cost_per_base_unit, qty_received, qty_remaining, received_at, created_at, updated_at) values (?,?,?,?,?,?,?,?,?,?,?)",
    [id("bdup"), id("p1"), id("br"), `B-${runId}`, "2026-12-31", 250, 10, 10, now, now, now],
  );
  await insertBatch(id("b2"), `B-${runId}`, "2027-01-31");
  ok("same batch_no with a different expiry accepted", true);

  // ------------------------------------------------------- batches: CHECKs
  await expectRejected(
    "batch expiry_date bad format rejected",
    "insert into batches (id, product_id, branch_id, batch_no, expiry_date, cost_per_base_unit, qty_received, qty_remaining, received_at, created_at, updated_at) values (?,?,?,?,?,?,?,?,?,?,?)",
    [id("bx"), id("p1"), id("br"), "B-FMT", "2026-2", 250, 10, 10, now, now, now],
  );
  await expectRejected(
    "batch negative qty_remaining rejected",
    "insert into batches (id, product_id, branch_id, batch_no, expiry_date, cost_per_base_unit, qty_received, qty_remaining, received_at, created_at, updated_at) values (?,?,?,?,?,?,?,?,?,?,?)",
    [id("bx"), id("p1"), id("br"), "B-NEG", "2026-02-28", 250, 10, -1, now, now, now],
  );

  // -------------------------------------------- stock_movements: CHECKs
  const insertMovement = (movementId: string, type: string, qtyDelta: number) =>
    run(
      "insert into stock_movements (id, batch_id, type, qty_delta, at, created_at) values (?,?,?,?,?,?)",
      [movementId, id("b1"), type, qtyDelta, now, now],
    );
  const movementSql =
    "insert into stock_movements (id, batch_id, type, qty_delta, at, created_at) values (?,?,?,?,?,?)";
  await expectRejected("movement qty_delta = 0 rejected", movementSql, [
    id("mz"),
    id("b1"),
    "adjust",
    0,
    now,
    now,
  ]);
  await expectRejected("sale with positive delta rejected", movementSql, [
    id("ms"),
    id("b1"),
    "sale",
    5,
    now,
    now,
  ]);
  await expectRejected("writeoff with positive delta rejected", movementSql, [
    id("mw"),
    id("b1"),
    "writeoff",
    5,
    now,
    now,
  ]);
  await expectRejected("receipt with negative delta rejected", movementSql, [
    id("mr"),
    id("b1"),
    "receipt",
    -5,
    now,
    now,
  ]);
  await expectRejected("return with negative delta rejected", movementSql, [
    id("mt"),
    id("b1"),
    "return",
    -5,
    now,
    now,
  ]);
  await insertMovement(id("m1"), "sale", -5);
  await insertMovement(id("m2"), "receipt", 5);
  await insertMovement(id("m3"), "adjust", -3);
  await insertMovement(id("m4"), "transfer", 3);
  ok("valid movement signs accepted", true);

  // -------------------------------------------------- append-only triggers
  await expectRejected(
    "stock_movements UPDATE blocked",
    "update stock_movements set reason = 'x' where id = ?",
    [id("m1")],
  );
  await expectRejected(
    "stock_movements DELETE blocked",
    "delete from stock_movements where id = ?",
    [id("m1")],
  );
  await run(
    "insert into controlled_register (id, product_id, batch_id, movement_id, balance_after, created_at) values (?,?,?,?,?,?)",
    [id("cr"), id("p1"), id("b1"), id("m1"), 95, now],
  );
  await expectRejected(
    "controlled_register UPDATE blocked",
    "update controlled_register set balance_after = 1 where id = ?",
    [id("cr")],
  );
  await expectRejected(
    "controlled_register DELETE blocked",
    "delete from controlled_register where id = ?",
    [id("cr")],
  );
  await run("insert into audit_log (id, action, entity, at, created_at) values (?,?,?,?,?)", [
    id("al"),
    "check",
    "check",
    now,
    now,
  ]);
  await expectRejected(
    "audit_log UPDATE blocked",
    "update audit_log set action = 'x' where id = ?",
    [id("al")],
  );
  await expectRejected("audit_log DELETE blocked", "delete from audit_log where id = ?", [
    id("al"),
  ]);

  // ------------------------------------------------------------- FTS5 sync
  const ftsIds = async (match: string) => {
    const response = await client.execute({
      sql: "select product_id from products_fts where products_fts match ?",
      args: [match],
    });
    return response.rows.map((row) => String(row.product_id));
  };
  const ftsMatch = async (match: string, productId: string) =>
    (await ftsIds(match)).includes(productId);

  ok("FTS finds product by name", await ftsMatch(`zzzitem`, id("p1")));
  ok("FTS finds product by generic name", await ftsMatch("paracetamol", id("p1")));
  ok("FTS finds product by sku", await ftsMatch("sku", id("p1")));
  ok("FTS finds a second product", await ftsMatch("qlonely", id("p2")));

  await run("update products set name = ? where id = ?", [`Qqqitem ${runId}`, id("p1")]);
  ok("FTS old name gone after rename", !(await ftsMatch("zzzitem", id("p1"))));
  ok("FTS new name found after rename", await ftsMatch("qqqitem", id("p1")));

  await run("delete from products where id = ?", [id("p2")]);
  ok("FTS row removed after product delete", !(await ftsMatch("qlonely", id("p2"))));

  // -------------------------------------------- users: case-insensitive email
  const userInsertSql =
    "insert into users (id, name, email, role, created_at, updated_at) values (?,?,?,?,?,?)";
  await expectRejected("duplicate email (lowercase vs stored mixed case) rejected", userInsertSql, [
    id("u3"),
    "Dup Lower",
    `check-cashier-${runId}@example.com`,
    "cashier",
    now,
    now,
  ]);
  await expectRejected("duplicate email (uppercase) rejected", userInsertSql, [
    id("u3"),
    "Dup Upper",
    `CHECK-CASHIER-${runId}@EXAMPLE.COM`,
    "cashier",
    now,
    now,
  ]);

  // ---------------------------------------- void / refund / rx-override cols
  await run(
    "update sales set status = 'voided', void_reason = 'check', voided_by = ?, voided_at = ? where id = ?",
    [id("u1"), now, id("s")],
  );
  ok("sales void columns writable", true);
  await run(
    "insert into sale_lines (id, sale_id, product_id, batch_id, unit_id, qty_base, unit_price, line_total, rx_override_by, rx_override_reason, created_at, updated_at) values (?,?,?,?,?,?,?,?,?,?,?,?)",
    [
      id("sl"),
      id("s"),
      id("p1"),
      id("b1"),
      id("pu"),
      5,
      250,
      1250,
      id("u1"),
      "verbal Rx confirmed",
      now,
      now,
    ],
  );
  ok("sale_lines rx-override columns writable", true);
  await run(
    "insert into refunds (id, sale_id, method, shift_id, processed_by, approved_by, total, created_at, updated_at) values (?,?,?,?,?,?,?,?,?)",
    [id("r"), id("s"), "cash", id("sh"), id("u1"), id("u1"), 1250, now, now],
  );
  ok("refunds method/shift/processed_by writable", true);
  await expectRejected(
    "refunds bad method rejected",
    "insert into refunds (id, sale_id, method, total, created_at, updated_at) values (?,?,?,?,?,?)",
    [id("r2"), id("s"), "bitcoin", 1, now, now],
  );
  await run(
    "insert into payments (id, sale_id, method, amount, created_at, updated_at) values (?,?,?,?,?,?)",
    [id("pay"), id("s"), "other", 1250, now, now],
  );
  ok("payments method 'other' accepted", true);
  await expectRejected(
    "payments bad method rejected",
    "insert into payments (id, sale_id, method, amount, created_at, updated_at) values (?,?,?,?,?,?)",
    [id("pay2"), id("s"), "bitcoin", 1, now, now],
  );

  // ------------------------------------------------ calendar-date GLOB CHECKs
  await expectRejected(
    "customers.dob bad format rejected",
    "insert into customers (id, name, dob, created_at, updated_at) values (?,?,?,?,?)",
    [id("c"), "Bad Dob", "31-12-1990", now, now],
  );
  await run("insert into customers (id, name, dob, created_at, updated_at) values (?,?,?,?,?)", [
    id("c"),
    "Good Dob",
    "1990-12-31",
    now,
    now,
  ]);
  ok("customers.dob valid format accepted", true);
  await expectRejected(
    "prescriptions.issued_on bad format rejected",
    "insert into prescriptions (id, patient_name, issued_on, created_at, updated_at) values (?,?,?,?,?)",
    [id("prx"), "Patient", "2026/01/01", now, now],
  );
  await expectRejected(
    "purchase_orders.expected_date bad format rejected",
    "insert into purchase_orders (id, branch_id, supplier_id, expected_date, created_at, updated_at) values (?,?,?,?,?,?)",
    [id("po"), id("br"), id("sup"), "12-01-2026", now, now],
  );
  await expectRejected(
    "supplier_invoices.due_date bad format rejected",
    "insert into supplier_invoices (id, supplier_id, number, amount, due_date, created_at, updated_at) values (?,?,?,?,?,?,?)",
    [id("si"), id("sup"), `INV-${runId}`, 1, "next week", now, now],
  );

  // ------------------------------------------------------------ rate_limits
  await run(
    "insert into rate_limits (key, count, window_start_ms, created_at, updated_at) values (?,?,?,?,?)",
    [`check:${runId}`, 1, now, now, now],
  );
  await expectRejected(
    "rate_limits negative count rejected",
    "update rate_limits set count = -1 where key = ?",
    [`check:${runId}`],
  );

  return results;
}

async function readPragma(client: Client, name: string): Promise<number | null> {
  try {
    const response = await client.execute(`pragma ${name}`);
    const value = response.rows[0]?.[name];
    return value === undefined ? null : Number(value);
  } catch {
    return null;
  }
}

function firstLine(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split("\n")[0].slice(0, 140);
}
