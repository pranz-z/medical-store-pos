import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { users } from "./auth";
import { productUnits, products } from "./catalog";
import { customers, prescriptions } from "./compliance";
import { branches } from "./core";
import { booleanFlag, createdAt, instant, money, primaryId, qty, updatedAt } from "./helpers";
import { batches } from "./inventory";

/**
 * Sales domain (spec §5.1, §5.3).
 *
 * Sales are never deleted; corrections happen through voids or refunds.
 * Receipt numbers are sequential per branch and allocated from `receipt_counters`
 * inside the checkout transaction (spec §5.3).
 */

export const receiptCounters = sqliteTable(
  "receipt_counters",
  {
    branchId: text("branch_id")
      .primaryKey()
      .references(() => branches.id),
    /** Next receipt number to allocate for this branch (starts at 1). */
    nextNo: integer("next_no").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [check("receipt_counters_next_no_check", sql`${table.nextNo} >= 1`)],
);

export const shifts = sqliteTable(
  "shifts",
  {
    id: primaryId(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    branchId: text("branch_id")
      .notNull()
      .references(() => branches.id),
    openedAt: instant("opened_at")
      .notNull()
      .$defaultFn(() => new Date()),
    closedAt: instant("closed_at"),
    openingFloat: money("opening_float").notNull().default(0),
    expectedCash: money("expected_cash"),
    countedCash: money("counted_cash"),
    variance: money("variance"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("shifts_branch_opened_idx").on(table.branchId, table.openedAt),
    index("shifts_user_opened_idx").on(table.userId, table.openedAt),
  ],
);

export const sales = sqliteTable(
  "sales",
  {
    id: primaryId(),
    /** Sequential per branch; unique together with branch_id. */
    receiptNo: integer("receipt_no").notNull(),
    branchId: text("branch_id")
      .notNull()
      .references(() => branches.id),
    shiftId: text("shift_id").references(() => shifts.id),
    cashierId: text("cashier_id")
      .notNull()
      .references(() => users.id),
    customerId: text("customer_id").references(() => customers.id),
    status: text("status").notNull().default("completed"),
    /** Void metadata (pre-payment / same-shift voids, FR-POS-9). */
    voidReason: text("void_reason"),
    voidedBy: text("voided_by").references(() => users.id),
    voidedAt: instant("voided_at"),
    /**
     * Client-supplied idempotency key (spec §6.1). Unique so a replayed checkout
     * returns the stored result instead of creating a second sale.
     */
    idempotencyKey: text("idempotency_key").notNull().unique(),
    subtotal: money("subtotal").notNull(),
    discountTotal: money("discount_total").notNull().default(0),
    taxTotal: money("tax_total").notNull().default(0),
    total: money("total").notNull(),
    /** Cash rounding adjustment in minor units (rounding rules are configuration). */
    rounding: money("rounding").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("sales_branch_receipt_uq").on(table.branchId, table.receiptNo),
    index("sales_branch_created_idx").on(table.branchId, table.createdAt),
    index("sales_customer_idx").on(table.customerId),
    index("sales_cashier_created_idx").on(table.cashierId, table.createdAt),
    index("sales_shift_idx").on(table.shiftId),
    check(
      "sales_status_check",
      sql`${table.status} in ('completed', 'voided', 'refunded', 'partially_refunded')`,
    ),
  ],
);

export const saleLines = sqliteTable(
  "sale_lines",
  {
    id: primaryId(),
    saleId: text("sale_id")
      .notNull()
      .references(() => sales.id),
    productId: text("product_id")
      .notNull()
      .references(() => products.id),
    /** FEFO-allocated batch; one sold line per batch when a line spans batches (spec §6.1). */
    batchId: text("batch_id")
      .notNull()
      .references(() => batches.id),
    /** Unit the customer bought (box/strip/tablet). */
    unitId: text("unit_id")
      .notNull()
      .references(() => productUnits.id),
    /** Quantity in base units (authoritative for stock). */
    qtyBase: qty("qty_base").notNull(),
    /** Price per sold unit in minor units (never trusted from the client). */
    unitPrice: money("unit_price").notNull(),
    /** Line discount in minor units. */
    discount: money("discount").notNull().default(0),
    /** Tax rate applied, in basis points. */
    taxRate: integer("tax_rate").notNull().default(0),
    /** Tax amount in minor units. */
    taxAmount: money("tax_amount").notNull().default(0),
    /** Line total in minor units (after discount; tax treatment per tax class). */
    lineTotal: money("line_total").notNull(),
    prescriptionId: text("prescription_id").references(() => prescriptions.id),
    /** Pharmacist override when an Rx-only item is sold without a recorded prescription (FR-POS-6). */
    rxOverrideBy: text("rx_override_by").references(() => users.id),
    rxOverrideReason: text("rx_override_reason"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("sale_lines_sale_idx").on(table.saleId),
    index("sale_lines_product_idx").on(table.productId),
    index("sale_lines_batch_idx").on(table.batchId),
    check("sale_lines_qty_base_check", sql`${table.qtyBase} > 0`),
    check("sale_lines_unit_price_check", sql`${table.unitPrice} >= 0`),
    check("sale_lines_discount_check", sql`${table.discount} >= 0`),
  ],
);

export const saleDiscounts = sqliteTable(
  "sale_discounts",
  {
    id: primaryId(),
    saleId: text("sale_id")
      .notNull()
      .references(() => sales.id),
    /** Discount type id from settings (senior_citizen, disability, staff, promo, ...). */
    type: text("type").notNull(),
    /** ID reference presented for eligibility (spec FR-POS-5). */
    idReference: text("id_reference"),
    amount: money("amount").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("sale_discounts_sale_idx").on(table.saleId),
    check("sale_discounts_amount_check", sql`${table.amount} >= 0`),
  ],
);

export const payments = sqliteTable(
  "payments",
  {
    id: primaryId(),
    saleId: text("sale_id")
      .notNull()
      .references(() => sales.id),
    method: text("method").notNull(),
    /** Amount applied to the bill; sums to `sales.total` across rows. */
    amount: money("amount").notNull(),
    /**
     * What the customer handed over (spec FR-POS-4). Equals `amount` for
     * non-cash methods; only cash may overpay. Null on pre-M2 rows.
     */
    tendered: money("tendered"),
    /** Change returned for this tender (cash only; always 0 for non-cash). */
    changeGiven: money("change_given").notNull().default(0),
    /** Card approval code, e-wallet reference, etc. */
    reference: text("reference"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("payments_sale_idx").on(table.saleId),
    check("payments_method_check", sql`${table.method} in ('cash', 'card', 'ewallet', 'other')`),
    check("payments_amount_check", sql`${table.amount} >= 0`),
    check("payments_change_given_check", sql`${table.changeGiven} >= 0`),
  ],
);

export const refunds = sqliteTable(
  "refunds",
  {
    id: primaryId(),
    saleId: text("sale_id")
      .notNull()
      .references(() => sales.id),
    /** How the money was returned; same value set as `payments.method`. */
    method: text("method").notNull(),
    /** Shift during which the refund was processed. */
    shiftId: text("shift_id").references(() => shifts.id),
    /** User who processed the refund (may differ from the approver). */
    processedBy: text("processed_by").references(() => users.id),
    approvedBy: text("approved_by").references(() => users.id),
    reason: text("reason"),
    total: money("total").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("refunds_sale_idx").on(table.saleId),
    index("refunds_shift_idx").on(table.shiftId),
    check("refunds_total_check", sql`${table.total} >= 0`),
    check("refunds_method_check", sql`${table.method} in ('cash', 'card', 'ewallet', 'other')`),
  ],
);

export const refundLines = sqliteTable(
  "refund_lines",
  {
    id: primaryId(),
    refundId: text("refund_id")
      .notNull()
      .references(() => refunds.id),
    /** The sale line being (partially) refunded; enforces refund <= sold - already refunded. */
    saleLineId: text("sale_line_id")
      .notNull()
      .references(() => saleLines.id),
    productId: text("product_id")
      .notNull()
      .references(() => products.id),
    batchId: text("batch_id")
      .notNull()
      .references(() => batches.id),
    unitId: text("unit_id")
      .notNull()
      .references(() => productUnits.id),
    qtyBase: qty("qty_base").notNull(),
    unitPrice: money("unit_price").notNull(),
    discount: money("discount").notNull().default(0),
    taxRate: integer("tax_rate").notNull().default(0),
    taxAmount: money("tax_amount").notNull().default(0),
    lineTotal: money("line_total").notNull(),
    /** Whether the item was put back on the shelf (spec FR-POS-9, optional restock). */
    restocked: booleanFlag("restocked", false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("refund_lines_refund_idx").on(table.refundId),
    index("refund_lines_sale_line_idx").on(table.saleLineId),
    check("refund_lines_qty_base_check", sql`${table.qtyBase} > 0`),
  ],
);
