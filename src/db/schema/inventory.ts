import { sql } from "drizzle-orm";
import { check, index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { users } from "./auth";
import { products } from "./catalog";
import { branches } from "./core";
import { calendarDate, createdAt, instant, money, primaryId, qty, updatedAt } from "./helpers";
import { suppliers } from "./purchasing";

/**
 * Inventory (spec §5.1, §5.3).
 *
 * `batches` carries the CHECK that stock can never go negative.
 * `stock_movements` is append-only: UPDATE/DELETE are blocked by triggers
 * created in the migration.
 *
 * Receiving an existing batch (same branch + product + batch_no + expiry)
 * tops up that row (`qty_received`/`qty_remaining` increase) and writes a
 * `stock_movements` row — it never inserts a duplicate batch row; the unique
 * index below enforces this.
 */

export const batches = sqliteTable(
  "batches",
  {
    id: primaryId(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id),
    branchId: text("branch_id")
      .notNull()
      .references(() => branches.id),
    batchNo: text("batch_no").notNull(),
    /** ISO `YYYY-MM-DD`; expiry is a calendar date, not an instant. */
    expiryDate: calendarDate("expiry_date").notNull(),
    costPerBaseUnit: money("cost_per_base_unit").notNull(),
    qtyReceived: qty("qty_received").notNull(),
    qtyRemaining: qty("qty_remaining").notNull(),
    supplierId: text("supplier_id").references(() => suppliers.id),
    receivedAt: instant("received_at")
      .notNull()
      .$defaultFn(() => new Date()),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    // One row per physical batch: receiving the same batch again tops it up.
    uniqueIndex("batches_branch_product_batch_expiry_uq").on(
      table.branchId,
      table.productId,
      table.batchNo,
      table.expiryDate,
    ),
    // FEFO lookups (spec §5.2): earliest expiry first, only batches with stock left.
    index("batches_fefo_idx")
      .on(table.productId, table.branchId, table.expiryDate)
      .where(sql`${table.qtyRemaining} > 0`),
    index("batches_expiry_idx").on(table.branchId, table.expiryDate),
    index("batches_supplier_idx").on(table.supplierId),
    // Integrity rule §5.3: stock can never go negative.
    check("batches_qty_remaining_nonnegative", sql`${table.qtyRemaining} >= 0`),
    check("batches_qty_received_nonnegative", sql`${table.qtyReceived} >= 0`),
    check("batches_cost_per_base_unit_check", sql`${table.costPerBaseUnit} >= 0`),
    check(
      "batches_expiry_date_format_check",
      sql`${table.expiryDate} glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`,
    ),
  ],
);

export const stockMovements = sqliteTable(
  "stock_movements",
  {
    id: primaryId(),
    batchId: text("batch_id")
      .notNull()
      .references(() => batches.id),
    type: text("type").notNull(),
    /** Signed delta in base units (+ receipt/return, - sale/writeoff). */
    qtyDelta: qty("qty_delta").notNull(),
    /** Reference to the document that caused the movement: sale, refund, receiving, ... */
    refType: text("ref_type"),
    refId: text("ref_id"),
    reason: text("reason"),
    userId: text("user_id").references(() => users.id),
    at: instant("at")
      .notNull()
      .$defaultFn(() => new Date()),
    createdAt: createdAt(),
  },
  (table) => [
    index("stock_movements_batch_at_idx").on(table.batchId, table.at),
    index("stock_movements_ref_idx").on(table.refType, table.refId),
    check(
      "stock_movements_type_check",
      sql`${table.type} in ('receipt', 'sale', 'return', 'adjust', 'transfer', 'writeoff')`,
    ),
    check("stock_movements_qty_delta_check", sql`${table.qtyDelta} <> 0`),
    // Directional integrity: sales/writeoffs always decrease, receipts/returns
    // always increase, adjustments/transfers may go either way.
    check(
      "stock_movements_sign_check",
      sql`(
        (${table.type} in ('sale', 'writeoff') and ${table.qtyDelta} < 0)
        or (${table.type} in ('receipt', 'return') and ${table.qtyDelta} > 0)
        or (${table.type} in ('adjust', 'transfer'))
      )`,
    ),
  ],
);
