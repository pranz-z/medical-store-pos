import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { users } from "./auth";
import { products } from "./catalog";
import { calendarDate, createdAt, primaryId, qty, updatedAt } from "./helpers";
import { batches, stockMovements } from "./inventory";

/**
 * Prescriptions, customers and the controlled-drug register (spec §5.1, §3.4).
 *
 * `controlled_register` is append-only: UPDATE/DELETE are blocked by triggers
 * created in the migration. Patient data here is sensitive (spec §9): access is
 * role-gated and must never be written to logs.
 */

export const customers = sqliteTable(
  "customers",
  {
    id: primaryId(),
    name: text("name").notNull(),
    phone: text("phone"),
    /** ISO `YYYY-MM-DD`. */
    dob: calendarDate("dob"),
    allergies: text("allergies"),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("customers_name_idx").on(table.name),
    index("customers_phone_idx").on(table.phone),
    check(
      "customers_dob_format_check",
      sql`${table.dob} is null or ${table.dob} glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`,
    ),
  ],
);

export const prescriptions = sqliteTable(
  "prescriptions",
  {
    id: primaryId(),
    customerId: text("customer_id").references(() => customers.id),
    patientName: text("patient_name").notNull(),
    /** Age OR date of birth (spec §3.4) — either may be supplied. */
    patientAge: integer("patient_age"),
    /** ISO `YYYY-MM-DD`. */
    patientDob: calendarDate("patient_dob"),
    prescriberName: text("prescriber_name"),
    prescriberLicense: text("prescriber_license"),
    /** ISO `YYYY-MM-DD` the prescription was issued. */
    issuedOn: calendarDate("issued_on"),
    /** Private Vercel Blob URL (signed access only, spec §9). */
    imageUrl: text("image_url"),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("prescriptions_customer_idx").on(table.customerId),
    index("prescriptions_issued_idx").on(table.issuedOn),
    check(
      "prescriptions_patient_age_check",
      sql`${table.patientAge} is null or (${table.patientAge} >= 0 and ${table.patientAge} <= 130)`,
    ),
    check(
      "prescriptions_issued_on_format_check",
      sql`${table.issuedOn} is null or ${table.issuedOn} glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`,
    ),
  ],
);

export const prescriptionItems = sqliteTable(
  "prescription_items",
  {
    id: primaryId(),
    prescriptionId: text("prescription_id")
      .notNull()
      .references(() => prescriptions.id),
    productId: text("product_id")
      .notNull()
      .references(() => products.id),
    /** In base units. Partial fills are `qtyDispensed < qtyPrescribed`. */
    qtyPrescribed: qty("qty_prescribed").notNull(),
    qtyDispensed: qty("qty_dispensed").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("prescription_items_prescription_idx").on(table.prescriptionId),
    index("prescription_items_product_idx").on(table.productId),
    check("prescription_items_qty_prescribed_check", sql`${table.qtyPrescribed} > 0`),
    check("prescription_items_qty_dispensed_check", sql`${table.qtyDispensed} >= 0`),
  ],
);

export const controlledRegister = sqliteTable(
  "controlled_register",
  {
    id: primaryId(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id),
    batchId: text("batch_id")
      .notNull()
      .references(() => batches.id),
    /** The append-only stock movement this register row documents. */
    movementId: text("movement_id")
      .notNull()
      .references(() => stockMovements.id),
    /** On-hand balance in base units for this product after the movement. */
    balanceAfter: qty("balance_after").notNull(),
    pharmacistId: text("pharmacist_id").references(() => users.id),
    prescriptionId: text("prescription_id").references(() => prescriptions.id),
    /** Patient name snapshot for register export (sensitive; redacted in audit viewer). */
    patientName: text("patient_name"),
    createdAt: createdAt(),
  },
  (table) => [
    index("controlled_register_product_idx").on(table.productId, table.createdAt),
    index("controlled_register_movement_idx").on(table.movementId),
  ],
);
