import { resolve } from "node:path";

import { hashPassword } from "better-auth/crypto";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabase, type DatabaseHandle } from "@/db/client";
import { grantApproval } from "@/lib/approvals";
import type { SessionUser } from "@/lib/auth/session";
import { addDaysIso, todayIso } from "@/lib/dates";
import { DomainError } from "@/lib/errors";
import { checkout, reprintSale, type CheckoutInput } from "@/lib/sales-mutations";
import { discountApprovalPayload } from "@/lib/pos-shared";
import type { Role } from "@/lib/roles";
import { closeShift, openShift } from "@/lib/shift-mutations";

import { cleanupTempDirectory, createTempDatabasePath } from "./helpers";

/**
 * Integration tests for M2 checkout (spec §6.1) against a throwaway local
 * libSQL file. Batches are inserted with raw SQL so expired rows can exist
 * (receiving rightly refuses them); the code under test is the same path
 * POST /api/sales calls.
 */

const BRANCH = "br-pos";
const TODAY = todayIso();
const EXPIRED = addDaysIso(TODAY, -1);
const SOON = addDaysIso(TODAY, 20);
const FAR = addDaysIso(TODAY, 200);

const actor = (role: Role): SessionUser => ({
  id: `u-${role}`,
  name: `${role} user`,
  email: `${role}@store.test`,
  role,
  branchId: BRANCH,
});

const CASHIER = actor("cashier");
const MANAGER = actor("manager");

let keySeq = 0;
const key = () => `test-key-${++keySeq}`;

const pay = (amountMinor: number, method: "cash" | "card" | "ewallet" | "other" = "cash") => [
  { method, amountMinor },
];

async function insertFixtures(handle: DatabaseHandle) {
  const now = Date.now();
  await handle.client.execute({
    sql: "insert into branches (id, name, created_at, updated_at) values (?,?,?,?)",
    args: [BRANCH, "POS branch", now, now],
  });
  const managerPin = await hashPassword("4321");
  for (const role of ["owner", "manager", "pharmacist", "cashier", "auditor"] as const) {
    await handle.client.execute({
      sql: `insert into users (id, name, email, role, branch_id, pin_hash, active, created_at, updated_at)
            values (?,?,?,?,?,?,1,?,?)`,
      args: [
        `u-${role}`,
        `${role} user`,
        `${role}@store.test`,
        role,
        BRANCH,
        role === "manager" ? managerPin : null,
        now,
        now,
      ],
    });
  }
  await handle.client.execute({
    sql: `insert into tax_classes (id, name, rate_bp, price_includes_tax, active, created_at, updated_at)
          values ('tax-vat', 'VAT 12%', 1200, 1, 1, ?, ?)`,
    args: [now, now],
  });

  const product = async (
    id: string,
    flags: { rx?: boolean; controlled?: string | null; loose?: boolean; taxClass?: string },
  ) => {
    await handle.client.execute({
      sql: `insert into products
            (id, sku, name, base_unit, tax_class_id, requires_rx, controlled_schedule,
             cold_chain, sellable_loose, reorder_level, active, created_at, updated_at)
            values (?,?,?,?,?,?,?,0,?,0,1,?,?)`,
      args: [
        id,
        `SKU-${id}`,
        `Product ${id}`,
        "tablet",
        flags.taxClass ?? null,
        flags.rx ? 1 : 0,
        flags.controlled ?? null,
        flags.loose === false ? 0 : 1,
        now,
        now,
      ],
    });
  };
  const unit = async (id: string, productId: string, name: string, factor: number, dft = 0) => {
    await handle.client.execute({
      sql: `insert into product_units (id, product_id, name, factor_to_base, is_default_sale, created_at, updated_at)
            values (?,?,?,?,?,?,?)`,
      args: [id, productId, name, factor, dft, now, now],
    });
  };
  const price = async (productId: string, unitId: string, priceMinor: number) => {
    await handle.client.execute({
      sql: `insert into product_prices (id, product_id, unit_id, price, effective_from, created_at, updated_at)
            values (?,?,?,?,?,?,?)`,
      args: [`pr-${unitId}`, productId, unitId, priceMinor, now - 60_000, now, now],
    });
  };

  // Normal product: ₱100/tablet, ₱950/box-of-10, not sellable loose.
  await product("p-sell", { loose: false });
  await unit("u-sell-tab", "p-sell", "tablet", 1, 1);
  await unit("u-sell-box", "p-sell", "box", 10);
  await price("p-sell", "u-sell-tab", 10_000);
  await price("p-sell", "u-sell-box", 95_000);
  // Loose product: box price 99950 → per-base = round(99950/10) = 9995.
  await product("p-loose", { loose: true });
  await unit("u-loose-tab", "p-loose", "tablet", 1, 1);
  await unit("u-loose-box", "p-loose", "box", 10);
  await price("p-loose", "u-loose-tab", 10_000);
  await price("p-loose", "u-loose-box", 99_950);
  // Blocked in M2.
  await product("p-rx", { rx: true });
  await unit("u-rx-tab", "p-rx", "tablet", 1, 1);
  await price("p-rx", "u-rx-tab", 5_000);
  await product("p-ctrl", { controlled: "S2" });
  await unit("u-ctrl-tab", "p-ctrl", "tablet", 1, 1);
  await price("p-ctrl", "u-ctrl-tab", 5_000);
  // VAT-inclusive pricing: 11200 → net 10000 + tax 1200.
  await product("p-vat", { taxClass: "tax-vat" });
  await unit("u-vat-tab", "p-vat", "tablet", 1, 1);
  await price("p-vat", "u-vat-tab", 11_200);
  // Dedicated product for the expired-stock test so other tests' batches
  // can't satisfy its line.
  await product("p-stale", {});
  await unit("u-stale-tab", "p-stale", "tablet", 1, 1);
  await price("p-stale", "u-stale-tab", 5_000);
}

/** Creates a product + tablet unit + price so each stock-sensitive test gets
 * exclusive stock — FEFO allocation is per product, so shared products bleed
 * stock between tests. */
async function stockProduct(handle: DatabaseHandle, id: string, priceMinor = 10_000) {
  const now = Date.now();
  await handle.client.execute({
    sql: `insert into products
          (id, sku, name, base_unit, requires_rx, controlled_schedule, cold_chain,
           sellable_loose, reorder_level, active, created_at, updated_at)
          values (?,?,?,?,0,null,0,1,0,1,?,?)`,
    args: [id, `SKU-${id}`, `Product ${id}`, "tablet", now, now],
  });
  await handle.client.execute({
    sql: `insert into product_units (id, product_id, name, factor_to_base, is_default_sale, created_at, updated_at)
          values (?,?,?,1,1,?,?)`,
    args: [`u-${id}-tab`, id, "tablet", now, now],
  });
  await handle.client.execute({
    sql: `insert into product_prices (id, product_id, unit_id, price, effective_from, created_at, updated_at)
          values (?,?,?,?,?,?,?)`,
    args: [`pr-${id}`, id, `u-${id}-tab`, priceMinor, now - 60_000, now, now],
  });
  return { productId: id, unitId: `u-${id}-tab` };
}

async function insertBatch(
  handle: DatabaseHandle,
  params: {
    id: string;
    productId: string;
    batchNo: string;
    expiryDate: string;
    qty: number;
    cost?: number;
  },
) {
  const now = Date.now();
  await handle.client.execute({
    sql: `insert into batches
          (id, product_id, branch_id, batch_no, expiry_date, cost_per_base_unit,
           qty_received, qty_remaining, received_at, created_at, updated_at)
          values (?,?,?,?,?,?,?,?,?,?,?)`,
    args: [
      params.id,
      params.productId,
      BRANCH,
      params.batchNo,
      params.expiryDate,
      params.cost ?? 100,
      params.qty,
      params.qty,
      now,
      now,
      now,
    ],
  });
}

const remaining = async (handle: DatabaseHandle, batchId: string) => {
  const rs = await handle.client.execute({
    sql: "select qty_remaining from batches where id = ?",
    args: [batchId],
  });
  return Number(rs.rows[0].qty_remaining);
};

const count = async (handle: DatabaseHandle, table: string, where = "") => {
  const rs = await handle.client.execute({
    sql: `select count(*) as n from ${table} ${where}`,
    args: [],
  });
  return Number(rs.rows[0].n);
};

describe("M2 checkout", () => {
  let directory: string;
  let handle: DatabaseHandle;

  beforeAll(async () => {
    const target = createTempDatabasePath("medical-store-pos");
    directory = target.directory;
    handle = createDatabase(target.url);
    await migrate(handle.db, { migrationsFolder: resolve("drizzle") });
    await insertFixtures(handle);
  });

  afterAll(() => {
    handle.client.close();
    cleanupTempDirectory(directory);
  });

  it("rejects checkout without an open shift", async () => {
    await insertBatch(handle, {
      id: "b-noshift",
      productId: "p-stale",
      batchNo: "B-NS",
      expiryDate: EXPIRED,
      qty: 10,
    });
    await expect(
      checkout(
        handle,
        CASHIER,
        {
          lines: [{ productId: "p-stale", unitId: "u-stale-tab", qtyBase: 1 }],
          payments: pay(10_000),
        },
        key(),
      ),
    ).rejects.toMatchObject({ name: "DomainError", code: "NO_SHIFT" });
  });

  it("completes a sale: totals, stock decrement, movement, payment and receipt number", async () => {
    await insertBatch(handle, {
      id: "b-basic",
      productId: "p-sell",
      batchNo: "B-BASIC",
      expiryDate: FAR,
      qty: 30,
    });
    const { shiftId } = await openShift(handle, CASHIER, { openingFloatMinor: 5_000 });

    const receipt = await checkout(
      handle,
      CASHIER,
      {
        lines: [{ productId: "p-sell", unitId: "u-sell-box", qtyBase: 20 }],
        payments: pay(200_000),
      },
      key(),
    );

    expect(receipt.receiptNo).toBe(1);
    expect(receipt.subtotalMinor).toBe(190_000); // 2 boxes × 95000
    expect(receipt.totalMinor).toBe(190_000);
    expect(receipt.changeMinor).toBe(10_000);
    expect(receipt.payments).toEqual([
      {
        method: "cash",
        amountMinor: 190_000,
        tenderedMinor: 200_000,
        changeMinor: 10_000,
        reference: null,
      },
    ]);
    expect(await remaining(handle, "b-basic")).toBe(10);

    const sale = await handle.client.execute({
      sql: "select shift_id, cashier_id, total from sales where id = ?",
      args: [receipt.saleId],
    });
    expect(String(sale.rows[0].shift_id)).toBe(shiftId);
    expect(String(sale.rows[0].cashier_id)).toBe(CASHIER.id);

    const movement = await handle.client.execute({
      sql: "select type, qty_delta from stock_movements where batch_id = ? and type = 'sale'",
      args: ["b-basic"],
    });
    expect(movement.rows).toHaveLength(1);
    expect(Number(movement.rows[0].qty_delta)).toBe(-20);
  });

  it("allocates FEFO and splits a line across two batches", async () => {
    await insertBatch(handle, {
      id: "b-far",
      productId: "p-loose",
      batchNo: "B-FAR",
      expiryDate: FAR,
      qty: 10,
    });
    await insertBatch(handle, {
      id: "b-soon",
      productId: "p-loose",
      batchNo: "B-SOON",
      expiryDate: SOON,
      qty: 4,
    });
    // Expired stock must never be drawn even when listed first by id.
    await insertBatch(handle, {
      id: "b-expired",
      productId: "p-loose",
      batchNo: "B-EXP",
      expiryDate: EXPIRED,
      qty: 50,
    });

    const receipt = await checkout(
      handle,
      CASHIER,
      {
        lines: [{ productId: "p-loose", unitId: "u-loose-tab", qtyBase: 6 }],
        payments: pay(100_000),
      },
      key(),
    );

    expect(receipt.lines).toHaveLength(2);
    expect(receipt.lines[0].batchNo).toBe("B-SOON");
    expect(receipt.lines[0].qtyBase).toBe(4);
    expect(receipt.lines[1].batchNo).toBe("B-FAR");
    expect(receipt.lines[1].qtyBase).toBe(2);
    expect(await remaining(handle, "b-soon")).toBe(0);
    expect(await remaining(handle, "b-far")).toBe(8);
    expect(await remaining(handle, "b-expired")).toBe(50);
  });

  it("rejects when only expired stock remains", async () => {
    await insertBatch(handle, {
      id: "b-stale",
      productId: "p-stale",
      batchNo: "B-STALE",
      expiryDate: EXPIRED,
      qty: 25,
    });
    await expect(
      checkout(
        handle,
        CASHIER,
        {
          lines: [{ productId: "p-stale", unitId: "u-stale-tab", qtyBase: 1 }],
          payments: pay(10_000),
        },
        key(),
      ),
    ).rejects.toMatchObject({ code: "STOCK_CHANGED" });
  });

  it("exactly one of two concurrent sales of the last units wins", async () => {
    const p = await stockProduct(handle, "p-race");
    await insertBatch(handle, {
      id: "b-race",
      productId: p.productId,
      batchNo: "B-RACE",
      expiryDate: FAR,
      qty: 5,
    });
    const input: CheckoutInput = {
      lines: [{ productId: p.productId, unitId: p.unitId, qtyBase: 5 }],
      payments: pay(60_000),
    };
    const outcomes = await Promise.allSettled([
      checkout(handle, CASHIER, input, key()),
      checkout(handle, CASHIER, input, key()),
    ]);
    const wins = outcomes.filter((o) => o.status === "fulfilled");
    const losses = outcomes.filter((o) => o.status === "rejected");
    expect(wins).toHaveLength(1);
    expect(losses).toHaveLength(1);
    const error = (losses[0] as PromiseRejectedResult).reason as DomainError;
    expect(error.code).toBe("STOCK_CHANGED");
    expect(error.details).toEqual([{ productId: p.productId, availableBase: 0 }]);
    expect(await remaining(handle, "b-race")).toBe(0);
  });

  it("replaying an idempotency key returns the stored sale without re-writing", async () => {
    const p = await stockProduct(handle, "p-idem");
    await insertBatch(handle, {
      id: "b-idem",
      productId: p.productId,
      batchNo: "B-IDEM",
      expiryDate: FAR,
      qty: 10,
    });
    const input: CheckoutInput = {
      lines: [{ productId: p.productId, unitId: p.unitId, qtyBase: 3 }],
      payments: pay(30_000),
    };
    const idemKey = key();
    const first = await checkout(handle, CASHIER, input, idemKey);
    const second = await checkout(handle, CASHIER, input, idemKey);

    expect(second.saleId).toBe(first.saleId);
    expect(second.receiptNo).toBe(first.receiptNo);
    expect(second.replayed).toBe(true);

    const saleCount = await count(handle, "sales", `where idempotency_key = '${idemKey}'`);
    expect(saleCount).toBe(1);
    expect(await remaining(handle, "b-idem")).toBe(7); // decremented once
    const movements = await count(
      handle,
      "stock_movements",
      "where batch_id = 'b-idem' and type = 'sale'",
    );
    expect(movements).toBe(1);
  });

  it("rolls back the whole sale when any line fails", async () => {
    await insertBatch(handle, {
      id: "b-ok",
      productId: "p-loose",
      batchNo: "B-OK",
      expiryDate: FAR,
      qty: 100,
    });
    const before = {
      sales: await count(handle, "sales"),
      lines: await count(handle, "sale_lines"),
      payments: await count(handle, "payments"),
      movements: await count(handle, "stock_movements"),
      counters: await count(handle, "receipt_counters"),
    };

    await expect(
      checkout(
        handle,
        CASHIER,
        {
          lines: [
            { productId: "p-loose", unitId: "u-loose-tab", qtyBase: 2 },
            { productId: "p-sell", unitId: "u-sell-tab", qtyBase: 500 }, // not enough stock
          ],
          payments: pay(50_000_000), // covers the due; the stock failure must fire first
        },
        key(),
      ),
    ).rejects.toMatchObject({ code: "STOCK_CHANGED" });

    expect(await count(handle, "sales")).toBe(before.sales);
    expect(await count(handle, "sale_lines")).toBe(before.lines);
    expect(await count(handle, "payments")).toBe(before.payments);
    expect(await count(handle, "stock_movements")).toBe(before.movements);
    expect(await count(handle, "receipt_counters")).toBe(before.counters);
  });

  it("allocates sequential receipt numbers with no gaps or duplicates under concurrency", async () => {
    const p = await stockProduct(handle, "p-seq");
    await insertBatch(handle, {
      id: "b-seq",
      productId: p.productId,
      batchNo: "B-SEQ",
      expiryDate: FAR,
      qty: 500,
    });
    const input = (): CheckoutInput => ({
      lines: [{ productId: p.productId, unitId: p.unitId, qtyBase: 1 }],
      payments: pay(10_000),
    });
    const receipts = await Promise.all(
      Array.from({ length: 5 }, () => checkout(handle, CASHIER, input(), key())),
    );
    const numbers = receipts.map((r) => r.receiptNo).sort((a, b) => a - b);
    const unique = new Set(numbers);
    expect(unique.size).toBe(5);
    for (let i = 1; i < numbers.length; i++) {
      expect(numbers[i]).toBe(numbers[i - 1] + 1);
    }
  });

  it("ignores client-supplied prices and totals", async () => {
    const p = await stockProduct(handle, "p-tamper");
    await insertBatch(handle, {
      id: "b-tamper",
      productId: p.productId,
      batchNo: "B-TMP",
      expiryDate: FAR,
      qty: 10,
    });
    const tampered = {
      lines: [
        {
          productId: p.productId,
          unitId: p.unitId,
          qtyBase: 2,
          unitPriceMinor: 1, // tampered — must be ignored
        },
      ],
      totalMinor: 2, // tampered — must be ignored
      payments: pay(20_000),
    } as unknown as CheckoutInput;
    const receipt = await checkout(handle, CASHIER, tampered, key());
    expect(receipt.totalMinor).toBe(20_000); // 2 × 10000 from product_prices
  });

  it("rejects a non-whole-unit quantity when the product is not sellable loose", async () => {
    await expect(
      checkout(
        handle,
        CASHIER,
        {
          lines: [{ productId: "p-sell", unitId: "u-sell-box", qtyBase: 15 }],
          payments: pay(200_000),
        },
        key(),
      ),
    ).rejects.toMatchObject({ code: "NOT_WHOLE_UNITS" });
  });

  it("prices loose quantities per base unit with the documented rounding rule", async () => {
    // 15 tablets sold at the box price: per-base = round(99950/10) = 9995.
    const receipt = await checkout(
      handle,
      CASHIER,
      {
        lines: [{ productId: "p-loose", unitId: "u-loose-box", qtyBase: 15 }],
        payments: pay(200_000),
      },
      key(),
    );
    expect(receipt.subtotalMinor).toBe(15 * 9_995);
    expect(receipt.totalMinor).toBe(149_925);
  });

  it("computes VAT-inclusive tax per line with half-up rounding", async () => {
    await insertBatch(handle, {
      id: "b-vat",
      productId: "p-vat",
      batchNo: "B-VAT",
      expiryDate: FAR,
      qty: 10,
    });
    const receipt = await checkout(
      handle,
      CASHIER,
      {
        lines: [{ productId: "p-vat", unitId: "u-vat-tab", qtyBase: 2 }],
        payments: pay(50_000),
      },
      key(),
    );
    // 2 × 11200 inclusive → tax = 22400 × 1200/11200 = 2400.
    expect(receipt.taxTotalMinor).toBe(2_400);
    expect(receipt.totalMinor).toBe(22_400);
    expect(receipt.lines[0].taxRateBp).toBe(1_200);
    expect(receipt.lines[0].taxMinor).toBe(2_400);
  });

  it("supports split tender and rejects non-cash overpay / under-tender", async () => {
    const p = await stockProduct(handle, "p-split");
    await insertBatch(handle, {
      id: "b-split",
      productId: p.productId,
      batchNo: "B-SPLIT",
      expiryDate: FAR,
      qty: 50,
    });
    const line = { productId: p.productId, unitId: p.unitId, qtyBase: 3 }; // 30000

    const receipt = await checkout(
      handle,
      CASHIER,
      {
        lines: [line],
        payments: [
          { method: "card", amountMinor: 20_000, reference: "AUTH-1" },
          { method: "cash", amountMinor: 15_000 },
        ],
      },
      key(),
    );
    expect(receipt.totalMinor).toBe(30_000);
    expect(receipt.payments[1].changeMinor).toBe(5_000);
    expect(receipt.changeMinor).toBe(5_000);

    await expect(
      checkout(
        handle,
        CASHIER,
        { lines: [line], payments: [{ method: "card", amountMinor: 31_000 }] },
        key(),
      ),
    ).rejects.toMatchObject({ code: "BAD_PAYMENT" });

    await expect(
      checkout(handle, CASHIER, { lines: [line], payments: pay(20_000) }, key()),
    ).rejects.toMatchObject({ code: "BAD_PAYMENT" });
  });

  it("enforces the discount cap and accepts a manager approval token", async () => {
    const p = await stockProduct(handle, "p-disc");
    await insertBatch(handle, {
      id: "b-disc",
      productId: p.productId,
      batchNo: "B-DISC",
      expiryDate: FAR,
      qty: 50,
    });
    // 30% line discount > 20% cap → approval required.
    const input: CheckoutInput = {
      lines: [{ productId: p.productId, unitId: p.unitId, qtyBase: 2, discountMinor: 6_000 }],
      payments: pay(14_000),
    };
    await expect(checkout(handle, CASHIER, input, key())).rejects.toMatchObject({
      code: "APPROVAL_REQUIRED",
    });

    // A manager approves; a cashier cannot approve; self-approval is rejected.
    await expect(
      grantApproval(handle, {
        approverEmail: "cashier@store.test",
        pin: "0000",
        requester: MANAGER,
        action: "sale.discount_over_limit",
        payload: discountApprovalPayload({
          lines: input.lines.map((l) => ({ ...l, discountMinor: l.discountMinor ?? 0 })),
          cartDiscountMinor: 0,
        }),
      }),
    ).rejects.toMatchObject({ code: "BAD_APPROVER" });
    await expect(
      grantApproval(handle, {
        approverEmail: "manager@store.test",
        pin: "4321",
        requester: MANAGER,
        action: "sale.discount_over_limit",
        payload: {},
      }),
    ).rejects.toMatchObject({ code: "SELF_APPROVAL" });

    const { token } = await grantApproval(handle, {
      approverEmail: "manager@store.test",
      pin: "4321",
      requester: CASHIER,
      action: "sale.discount_over_limit",
      payload: discountApprovalPayload({
        lines: input.lines.map((l) => ({ ...l, discountMinor: l.discountMinor ?? 0 })),
        cartDiscountMinor: 0,
      }),
    });
    const receipt = await checkout(handle, CASHIER, { ...input, approvalToken: token }, key());
    expect(receipt.discountTotalMinor).toBe(6_000);
    expect(receipt.totalMinor).toBe(14_000);

    // The token is single-use.
    await expect(
      checkout(handle, CASHIER, { ...input, approvalToken: token }, key()),
    ).rejects.toMatchObject({ code: "BAD_APPROVAL" });
  });

  it("blocks requires_rx and controlled products with the M3 message", async () => {
    await insertBatch(handle, {
      id: "b-rx",
      productId: "p-rx",
      batchNo: "B-RX",
      expiryDate: FAR,
      qty: 10,
    });
    await insertBatch(handle, {
      id: "b-ctrl",
      productId: "p-ctrl",
      batchNo: "B-CTRL",
      expiryDate: FAR,
      qty: 10,
    });
    for (const [productId, unitId] of [
      ["p-rx", "u-rx-tab"],
      ["p-ctrl", "u-ctrl-tab"],
    ] as const) {
      await expect(
        checkout(
          handle,
          CASHIER,
          {
            lines: [{ productId, unitId, qtyBase: 1 }],
            payments: pay(10_000),
          },
          key(),
        ),
      ).rejects.toThrow("Prescription handling arrives in the next release.");
    }
  });

  it("enforces the permission matrix: seller roles sell, auditor cannot", async () => {
    const p = await stockProduct(handle, "p-perm");
    await insertBatch(handle, {
      id: "b-perm",
      productId: p.productId,
      batchNo: "B-PERM",
      expiryDate: FAR,
      qty: 50,
    });
    for (const role of ["pharmacist", "manager", "owner"] as const) {
      const user = actor(role);
      await openShift(handle, user, { openingFloatMinor: 0 });
      const receipt = await checkout(
        handle,
        user,
        {
          lines: [{ productId: p.productId, unitId: p.unitId, qtyBase: 1 }],
          payments: pay(10_000),
        },
        key(),
      );
      expect(receipt.totalMinor).toBe(10_000);
    }
    const auditor = actor("auditor");
    await expect(openShift(handle, auditor, { openingFloatMinor: 0 })).rejects.toThrow(
      /permission/i,
    );
    await expect(
      checkout(
        handle,
        auditor,
        {
          lines: [{ productId: p.productId, unitId: p.unitId, qtyBase: 1 }],
          payments: pay(10_000),
        },
        key(),
      ),
    ).rejects.toThrow(/permission/i);
  });

  it("shift close computes expected cash and variance", async () => {
    // CASHIER's shift from earlier tests: opening 5000 + cash sales - change.
    const cash = await handle.client.execute({
      sql: `select s.id from shifts s where s.user_id = ? and s.closed_at is null`,
      args: [CASHIER.id],
    });
    const shiftId = String(cash.rows[0].id);
    const sums = await handle.client.execute({
      sql: `select coalesce(sum(p.amount),0) as received, coalesce(sum(p.change_given),0) as change
            from payments p join sales s on s.id = p.sale_id
            where s.shift_id = ? and p.method = 'cash'`,
      args: [shiftId],
    });
    const expected = 5_000 + Number(sums.rows[0].received) - Number(sums.rows[0].change);

    const result = await closeShift(handle, CASHIER, {
      shiftId,
      countedCashMinor: expected - 1_000,
    });
    expect(result.expectedCashMinor).toBe(expected);
    expect(result.varianceMinor).toBe(-1_000);

    // Closed shift can no longer sell.
    await expect(
      checkout(
        handle,
        CASHIER,
        {
          lines: [{ productId: "p-perm", unitId: "u-p-perm-tab", qtyBase: 1 }],
          payments: pay(10_000),
        },
        key(),
      ),
    ).rejects.toMatchObject({ code: "NO_SHIFT" });
  });

  it("reprinting a receipt is audited", async () => {
    const p = await stockProduct(handle, "p-rp");
    await insertBatch(handle, {
      id: "b-reprint",
      productId: p.productId,
      batchNo: "B-RP",
      expiryDate: FAR,
      qty: 10,
    });
    await openShift(handle, CASHIER, { openingFloatMinor: 0 });
    const receipt = await checkout(
      handle,
      CASHIER,
      {
        lines: [{ productId: p.productId, unitId: p.unitId, qtyBase: 1 }],
        payments: pay(10_000),
      },
      key(),
    );
    const reprint = await reprintSale(handle, MANAGER, receipt.saleId);
    expect(reprint.receiptNo).toBe(receipt.receiptNo);
    const audit = await handle.client.execute({
      sql: "select action from audit_log where entity_id = ? and action = 'sale.reprinted'",
      args: [receipt.saleId],
    });
    expect(audit.rows).toHaveLength(1);
  });
});
