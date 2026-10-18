import { resolve } from "node:path";

import { migrate } from "drizzle-orm/libsql/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabase, type DatabaseHandle } from "@/db/client";
import type { SessionUser } from "@/lib/auth/session";
import { createProduct, setProductPrice } from "@/lib/catalog-mutations";
import { addDaysIso, todayIso } from "@/lib/dates";
import { adjustStock, receiveStock } from "@/lib/inventory-mutations";
import type { Role } from "@/lib/roles";

import { cleanupTempDirectory, createTempDatabasePath } from "./helpers";

/**
 * Integration tests for the M1 inventory mutations (spec §3.3, §6.3) against a
 * throwaway local libSQL file. Fixtures are inserted with raw SQL; the code
 * under test is the same path the server actions call.
 */

const BRANCH = "br-test";
const EXPIRY_FAR = addDaysIso(todayIso(), 180);

const actor = (role: Role): SessionUser => ({
  id: `u-${role}`,
  name: role,
  email: `${role}@store.test`,
  role,
  branchId: BRANCH,
});

const MANAGER = actor("manager");

async function insertFixtures(handle: DatabaseHandle) {
  const now = Date.now();
  await handle.client.execute({
    sql: "insert into branches (id, name, created_at, updated_at) values (?,?,?,?)",
    args: [BRANCH, "Test branch", now, now],
  });
  for (const role of ["owner", "manager", "pharmacist", "cashier", "auditor"] as const) {
    await handle.client.execute({
      sql: `insert into users (id, name, email, role, branch_id, active, created_at, updated_at)
            values (?,?,?,?,?,1,?,?)`,
      args: [`u-${role}`, role, `${role}@store.test`, role, BRANCH, now, now],
    });
  }
  await handle.client.execute({
    sql: "insert into suppliers (id, name, active, created_at, updated_at) values (?,?,1,?,?)",
    args: ["sup-1", "Test supplier", now, now],
  });
  // One normal product (tablet base, box-of-10 unit) and one controlled product.
  for (const [id, controlled] of [
    ["p-normal", null],
    ["p-controlled", "S2"],
  ] as const) {
    await handle.client.execute({
      sql: `insert into products
            (id, sku, name, base_unit, requires_rx, controlled_schedule, cold_chain,
             sellable_loose, reorder_level, active, created_at, updated_at)
            values (?,?,?,?,0,?,0,1,0,1,?,?)`,
      args: [id, `SKU-${id}`, `Product ${id}`, "tablet", controlled, now, now],
    });
    await handle.client.execute({
      sql: `insert into product_units (id, product_id, name, factor_to_base, is_default_sale, created_at, updated_at)
            values (?,?,?,?,?,?,?)`,
      args: [`u-${id}-box`, id, "box", 10, 1, now, now],
    });
    await handle.client.execute({
      sql: `insert into product_units (id, product_id, name, factor_to_base, is_default_sale, created_at, updated_at)
            values (?,?,?,?,0,?,?)`,
      args: [`u-${id}-tablet`, id, "tablet", 1, now, now],
    });
  }
}

async function batchRow(handle: DatabaseHandle, batchId: string) {
  const result = await handle.client.execute({
    sql: "select qty_received, qty_remaining from batches where id = ?",
    args: [batchId],
  });
  return result.rows[0] as unknown as { qty_received: number; qty_remaining: number } | undefined;
}

describe("M1 inventory mutations", () => {
  let directory: string;
  let handle: DatabaseHandle;

  beforeAll(async () => {
    const target = createTempDatabasePath("medical-store-inv");
    directory = target.directory;
    handle = createDatabase(target.url);
    await migrate(handle.db, { migrationsFolder: resolve("drizzle") });
    await insertFixtures(handle);
  });

  afterAll(() => {
    handle.client.close();
    cleanupTempDirectory(directory);
  });

  it("receiving creates a batch, a movement and a controlled-register row", async () => {
    const result = await receiveStock(handle, MANAGER, {
      supplierId: "sup-1",
      reference: "DR-1001",
      lines: [
        {
          productId: "p-controlled",
          unitId: "u-p-controlled-box",
          batchNo: "B-CTRL-1",
          expiryDate: EXPIRY_FAR,
          qty: 2,
          unitCostMinor: 12_000,
        },
      ],
    });

    const batch = await batchRow(handle, result.lines[0].batchId);
    // 2 boxes × 10 = 20 base units; ₱120/box → ₱12/tablet.
    expect(batch).toEqual({ qty_received: 20, qty_remaining: 20 });
    expect(result.lines[0].qtyBase).toBe(20);
    expect(result.lines[0].costPerBaseUnitMinor).toBe(1_200);
    expect(result.lines[0].toppedUp).toBe(false);

    const movement = await handle.client.execute({
      sql: "select type, qty_delta, user_id from stock_movements where batch_id = ?",
      args: [result.lines[0].batchId],
    });
    expect(movement.rows).toHaveLength(1);
    expect(String(movement.rows[0].type)).toBe("receipt");
    expect(Number(movement.rows[0].qty_delta)).toBe(20);

    const register = await handle.client.execute({
      sql: "select balance_after from controlled_register where batch_id = ?",
      args: [result.lines[0].batchId],
    });
    expect(register.rows).toHaveLength(1);
    expect(Number(register.rows[0].balance_after)).toBe(20);

    const audit = await handle.client.execute({
      sql: "select action from audit_log where entity = 'receiving' order by at desc limit 1",
      args: [],
    });
    expect(String(audit.rows[0].action)).toBe("stock.received");
  });

  it("receiving an existing batch tops it up instead of inserting a duplicate", async () => {
    const first = await receiveStock(handle, MANAGER, {
      lines: [
        {
          productId: "p-normal",
          unitId: "u-p-normal-tablet",
          batchNo: "B-TOP",
          expiryDate: EXPIRY_FAR,
          qty: 10,
          unitCostMinor: 100,
        },
      ],
    });
    const second = await receiveStock(handle, MANAGER, {
      lines: [
        {
          productId: "p-normal",
          unitId: "u-p-normal-tablet",
          batchNo: "B-TOP",
          expiryDate: EXPIRY_FAR,
          qty: 5,
          unitCostMinor: 100,
        },
      ],
    });

    expect(second.lines[0].toppedUp).toBe(true);
    expect(second.lines[0].batchId).toBe(first.lines[0].batchId);

    const count = await handle.client.execute({
      sql: "select count(*) as n from batches where product_id = 'p-normal' and batch_no = 'B-TOP'",
      args: [],
    });
    expect(Number(count.rows[0].n)).toBe(1);

    const batch = await batchRow(handle, first.lines[0].batchId);
    expect(batch).toEqual({ qty_received: 15, qty_remaining: 15 });

    const movements = await handle.client.execute({
      sql: "select count(*) as n from stock_movements where batch_id = ?",
      args: [first.lines[0].batchId],
    });
    expect(Number(movements.rows[0].n)).toBe(2);
  });

  it("rejects receiving stock with a near or past expiry", async () => {
    await expect(
      receiveStock(handle, MANAGER, {
        lines: [
          {
            productId: "p-normal",
            unitId: "u-p-normal-tablet",
            batchNo: "B-SHORT",
            expiryDate: addDaysIso(todayIso(), 10),
            qty: 1,
            unitCostMinor: 100,
          },
        ],
      }),
    ).rejects.toThrow(/shelf-life|past/i);
  });

  it("an adjustment cannot take qty_remaining below zero", async () => {
    const receipt = await receiveStock(handle, MANAGER, {
      lines: [
        {
          productId: "p-normal",
          unitId: "u-p-normal-tablet",
          batchNo: "B-ADJ",
          expiryDate: EXPIRY_FAR,
          qty: 6,
          unitCostMinor: 100,
        },
      ],
    });
    const batchId = receipt.lines[0].batchId;

    await expect(
      adjustStock(handle, MANAGER, { batchId, reason: "damage", qtyDeltaBase: -7 }),
    ).rejects.toThrow(/remain|insufficient/i);

    const batch = await batchRow(handle, batchId);
    expect(batch?.qty_remaining).toBe(6);
  });

  it("two concurrent adjustments on the last units yield exactly one success", async () => {
    const receipt = await receiveStock(handle, MANAGER, {
      lines: [
        {
          productId: "p-normal",
          unitId: "u-p-normal-tablet",
          batchNo: "B-RACE",
          expiryDate: EXPIRY_FAR,
          qty: 5,
          unitCostMinor: 100,
        },
      ],
    });
    const batchId = receipt.lines[0].batchId;

    const outcomes = await Promise.allSettled([
      adjustStock(handle, MANAGER, { batchId, reason: "damage", qtyDeltaBase: -5 }),
      adjustStock(handle, MANAGER, { batchId, reason: "theft", qtyDeltaBase: -5 }),
    ]);

    const succeeded = outcomes.filter((o) => o.status === "fulfilled");
    const failed = outcomes.filter((o) => o.status === "rejected");
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect((failed[0] as PromiseRejectedResult).reason).toMatchObject({
      name: "DomainError",
    });

    const batch = await batchRow(handle, batchId);
    expect(batch?.qty_remaining).toBe(0);
  });

  it("controlled_register balance tracks the product's on-hand after receive + adjust", async () => {
    const receipt = await receiveStock(handle, MANAGER, {
      lines: [
        {
          productId: "p-controlled",
          unitId: "u-p-controlled-tablet",
          batchNo: "B-CTRL-2",
          expiryDate: EXPIRY_FAR,
          qty: 30,
          unitCostMinor: 50,
        },
      ],
    });
    const batchId = receipt.lines[0].batchId;

    await adjustStock(handle, MANAGER, {
      batchId,
      reason: "expiry_writeoff",
      qtyDeltaBase: -8,
    });

    const register = await handle.client.execute({
      sql: `select balance_after from controlled_register
            where product_id = 'p-controlled' order by rowid asc`,
      args: [],
    });
    // Entries: 20 (first test's receipt), 50 (this receipt), 42 (this write-off).
    expect(register.rows.map((row) => Number(row.balance_after))).toEqual([20, 50, 42]);

    const onHand = await handle.client.execute({
      sql: "select coalesce(sum(qty_remaining),0) as n from batches where product_id = 'p-controlled'",
      args: [],
    });
    expect(Number(onHand.rows[0].n)).toBe(42);
  });

  it("a price change closes the current row and keeps history", async () => {
    const created = await createProduct(handle, MANAGER, {
      sku: "PRC-1",
      name: "Price history test",
      baseUnit: "tablet",
      priceMinor: 100,
    });
    const unitId = created.unitId;

    await setProductPrice(handle, MANAGER, {
      productId: created.productId,
      unitId,
      priceMinor: 150,
    });
    await setProductPrice(handle, MANAGER, {
      productId: created.productId,
      unitId,
      priceMinor: 175,
    });

    const rows = await handle.client.execute({
      sql: `select price, effective_to from product_prices
            where product_id = ? order by rowid asc`,
      args: [created.productId],
    });
    expect(rows.rows).toHaveLength(3);
    // First two rows are closed; only the newest stays open.
    expect(rows.rows[0].effective_to).not.toBeNull();
    expect(rows.rows[1].effective_to).not.toBeNull();
    expect(rows.rows[2].effective_to).toBeNull();
    expect(rows.rows.map((row) => Number(row.price))).toEqual([100, 150, 175]);
  });

  it("enforces the permission matrix on mutations", async () => {
    const receiveInput = {
      lines: [
        {
          productId: "p-normal",
          unitId: "u-p-normal-tablet",
          batchNo: "B-PERM",
          expiryDate: EXPIRY_FAR,
          qty: 1,
          unitCostMinor: 10,
        },
      ],
    };

    // Cashier and auditor cannot receive, adjust, manage catalog, price or import.
    for (const role of ["cashier", "auditor"] as const) {
      const denied = actor(role);
      await expect(receiveStock(handle, denied, receiveInput)).rejects.toThrow(/permission/i);
      await expect(
        adjustStock(handle, denied, { batchId: "any", reason: "damage", qtyDeltaBase: -1 }),
      ).rejects.toThrow(/permission/i);
      await expect(
        createProduct(handle, denied, { sku: `X-${role}`, name: "nope", baseUnit: "tablet" }),
      ).rejects.toThrow(/permission/i);
      await expect(
        setProductPrice(handle, denied, {
          productId: "p-normal",
          unitId: "u-p-normal-tablet",
          priceMinor: 1,
        }),
      ).rejects.toThrow(/permission/i);
    }

    // Pharmacist can receive/adjust but cannot manage catalog or prices.
    const pharmacist = actor("pharmacist");
    await expect(receiveStock(handle, pharmacist, receiveInput)).resolves.toBeDefined();
    await expect(
      createProduct(handle, pharmacist, { sku: "X-pharm", name: "nope", baseUnit: "tablet" }),
    ).rejects.toThrow(/permission/i);
    await expect(
      setProductPrice(handle, pharmacist, {
        productId: "p-normal",
        unitId: "u-p-normal-tablet",
        priceMinor: 1,
      }),
    ).rejects.toThrow(/permission/i);
  });
});
