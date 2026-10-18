import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { users } from "./auth";
import { products } from "./catalog";
import { branches } from "./core";
import {
  booleanFlag,
  calendarDate,
  createdAt,
  instant,
  money,
  primaryId,
  updatedAt,
} from "./helpers";

/** Purchasing and suppliers (spec §5.1, §3.5). */

export const suppliers = sqliteTable(
  "suppliers",
  {
    id: primaryId(),
    name: text("name").notNull(),
    /** Free-form contact details (person, phone, email, address). */
    contact: text("contact"),
    termsDays: integer("terms_days"),
    leadTimeDays: integer("lead_time_days"),
    active: booleanFlag("active", true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("suppliers_name_idx").on(table.name),
    check("suppliers_terms_days_check", sql`${table.termsDays} is null or ${table.termsDays} >= 0`),
    check(
      "suppliers_lead_time_days_check",
      sql`${table.leadTimeDays} is null or ${table.leadTimeDays} >= 0`,
    ),
  ],
);

export const purchaseOrders = sqliteTable(
  "purchase_orders",
  {
    id: primaryId(),
    branchId: text("branch_id")
      .notNull()
      .references(() => branches.id),
    supplierId: text("supplier_id")
      .notNull()
      .references(() => suppliers.id),
    status: text("status").notNull().default("draft"),
    expectedDate: calendarDate("expected_date"),
    notes: text("notes"),
    createdBy: text("created_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("purchase_orders_branch_idx").on(table.branchId, table.createdAt),
    index("purchase_orders_supplier_status_idx").on(table.supplierId, table.status),
    check(
      "purchase_orders_status_check",
      sql`${table.status} in ('draft', 'sent', 'partially_received', 'received', 'cancelled')`,
    ),
    check(
      "purchase_orders_expected_date_format_check",
      sql`${table.expectedDate} is null or ${table.expectedDate} glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`,
    ),
  ],
);

export const poLines = sqliteTable(
  "po_lines",
  {
    id: primaryId(),
    poId: text("po_id")
      .notNull()
      .references(() => purchaseOrders.id),
    productId: text("product_id")
      .notNull()
      .references(() => products.id),
    /** In base units. */
    qtyOrdered: integer("qty_ordered").notNull(),
    qtyReceived: integer("qty_received").notNull().default(0),
    /**
     * Cost in minor units per BASE unit (aligns with `batches.cost_per_base_unit`).
     * Purchase-unit costs (per box, per strip) are converted by the receiving
     * form before they reach this column.
     */
    unitCost: money("unit_cost").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("po_lines_po_idx").on(table.poId),
    index("po_lines_product_idx").on(table.productId),
    check("po_lines_qty_ordered_check", sql`${table.qtyOrdered} > 0`),
    check("po_lines_qty_received_check", sql`${table.qtyReceived} >= 0`),
    check("po_lines_unit_cost_check", sql`${table.unitCost} >= 0`),
  ],
);

export const supplierInvoices = sqliteTable(
  "supplier_invoices",
  {
    id: primaryId(),
    supplierId: text("supplier_id")
      .notNull()
      .references(() => suppliers.id),
    poId: text("po_id").references(() => purchaseOrders.id),
    /** Supplier's own invoice number. */
    number: text("number").notNull(),
    amount: money("amount").notNull(),
    dueDate: calendarDate("due_date"),
    paidAt: instant("paid_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("supplier_invoices_supplier_idx").on(table.supplierId, table.dueDate),
    index("supplier_invoices_paid_idx").on(table.paidAt),
    check("supplier_invoices_amount_check", sql`${table.amount} >= 0`),
    check(
      "supplier_invoices_due_date_format_check",
      sql`${table.dueDate} is null or ${table.dueDate} glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`,
    ),
  ],
);
