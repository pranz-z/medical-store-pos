import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { booleanFlag, createdAt, instant, money, primaryId, updatedAt } from "./helpers";

/**
 * Product catalog (spec §5.1).
 *
 * `categories` and `tax_classes` are small lookup tables added in M0 so that
 * `products.category_id` and `products.tax_class_id` have real foreign keys
 * (the §5.1 table list references them but does not define them).
 */

export const categories = sqliteTable("categories", {
  id: primaryId(),
  name: text("name").notNull().unique(),
  active: booleanFlag("active", true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const taxClasses = sqliteTable(
  "tax_classes",
  {
    id: primaryId(),
    name: text("name").notNull().unique(),
    /** Tax rate in basis points: 1200 = 12.00%. Integer only. */
    rateBp: integer("rate_bp").notNull(),
    /** Whether catalog prices for this class already include tax (PH VAT prices do). */
    priceIncludesTax: booleanFlag("price_includes_tax", true),
    active: booleanFlag("active", true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    check("tax_classes_rate_bp_check", sql`${table.rateBp} >= 0 and ${table.rateBp} <= 10000`),
  ],
);

export const products = sqliteTable(
  "products",
  {
    id: primaryId(),
    sku: text("sku").notNull().unique(),
    name: text("name").notNull(),
    genericName: text("generic_name"),
    strength: text("strength"),
    /** Dosage form: tablet, capsule, syrup, cream, ... */
    form: text("form"),
    manufacturer: text("manufacturer"),
    categoryId: text("category_id").references(() => categories.id),
    /** Base unit for quantities: tablet, capsule, ml, sachet, ... */
    baseUnit: text("base_unit").notNull(),
    taxClassId: text("tax_class_id").references(() => taxClasses.id),
    requiresRx: booleanFlag("requires_rx", false),
    /** Controlled-substance schedule label; non-null means the item is controlled. */
    controlledSchedule: text("controlled_schedule"),
    coldChain: booleanFlag("cold_chain", false),
    sellableLoose: booleanFlag("sellable_loose", true),
    storageNotes: text("storage_notes"),
    /** Reorder threshold in base units. */
    reorderLevel: integer("reorder_level").notNull().default(0),
    active: booleanFlag("active", true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    // Note: `products_fts` (FTS5 over name/generic_name/sku, spec §5.2) is created
    // in the migration SQL because Drizzle cannot model virtual tables.
    index("products_name_idx").on(table.name),
    index("products_generic_name_idx").on(table.genericName),
    index("products_category_idx").on(table.categoryId),
    check("products_reorder_level_check", sql`${table.reorderLevel} >= 0`),
  ],
);

export const productUnits = sqliteTable(
  "product_units",
  {
    id: primaryId(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id),
    /** Unit name as sold: box, strip, tablet, bottle, ... */
    name: text("name").notNull(),
    /** How many base units one of this unit contains (1 box = 100 tablets -> 100). */
    factorToBase: integer("factor_to_base").notNull(),
    isDefaultSale: booleanFlag("is_default_sale", false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("product_units_product_name_uq").on(table.productId, table.name),
    index("product_units_product_idx").on(table.productId),
    check("product_units_factor_to_base_check", sql`${table.factorToBase} > 0`),
  ],
);

export const productBarcodes = sqliteTable(
  "product_barcodes",
  {
    id: primaryId(),
    barcode: text("barcode").notNull().unique(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id),
    /** The unit this barcode represents (a box barcode scans as 1 box). */
    unitId: text("unit_id").references(() => productUnits.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("product_barcodes_product_idx").on(table.productId)],
);

export const productPrices = sqliteTable(
  "product_prices",
  {
    id: primaryId(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id),
    unitId: text("unit_id")
      .notNull()
      .references(() => productUnits.id),
    /** Selling price in minor units for one of `unit_id`. */
    price: money("price").notNull(),
    effectiveFrom: instant("effective_from")
      .notNull()
      .$defaultFn(() => new Date()),
    /** Null means this is the current price. Past rows are never rewritten (spec §3.2). */
    effectiveTo: instant("effective_to"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("product_prices_lookup_idx").on(table.productId, table.unitId, table.effectiveFrom),
    check("product_prices_price_check", sql`${table.price} >= 0`),
  ],
);
