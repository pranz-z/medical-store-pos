import { z } from "zod";

import type { DatabaseHandle } from "@/db/client";
import type { JsonValue } from "@/db/schema/system";
import { buildAuditStatement } from "@/lib/audit";
import type { SessionUser } from "@/lib/auth/session";
import { DomainError } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { requireCapability } from "@/lib/permissions";
import { withWriteTx } from "@/lib/tx";

/**
 * Catalog mutations (spec §3.2): product create/update/deactivate, units,
 * barcodes, categories, and price changes. Every function takes the acting
 * `SessionUser`, enforces its capability server-side, writes the change and
 * its `audit_log` row in one transaction, and throws `DomainError` for
 * expected business rejections.
 *
 * Price history is append-only (spec §3.2): a price change closes the open
 * `product_prices` row (`effective_to = now`) and inserts a new one — past
 * rows are never rewritten or deleted.
 */

const trimmed = (max: number) => z.string().trim().min(1).max(max);
const optionalTrimmed = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value.length === 0 ? null : value))
    .nullable()
    .optional();

export const productFieldsSchema = z.object({
  sku: trimmed(64).regex(/^[A-Za-z0-9._-]+$/, "SKU: letters, digits, '.', '_' and '-' only."),
  name: trimmed(200),
  genericName: optionalTrimmed(200),
  strength: optionalTrimmed(80),
  form: optionalTrimmed(60),
  manufacturer: optionalTrimmed(120),
  categoryId: z.string().trim().min(1).nullable().optional(),
  baseUnit: trimmed(40),
  taxClassId: z.string().trim().min(1).nullable().optional(),
  requiresRx: z.boolean().default(false),
  controlledSchedule: optionalTrimmed(60),
  coldChain: z.boolean().default(false),
  sellableLoose: z.boolean().default(true),
  storageNotes: optionalTrimmed(500),
  reorderLevel: z.number().int().min(0).default(0),
});
export type ProductFieldsInput = z.input<typeof productFieldsSchema>;

export const createProductSchema = productFieldsSchema.extend({
  /** Initial price for the auto-created base unit (minor units). Optional. */
  priceMinor: z.number().int().min(0).optional(),
  /** Optional barcode attached to the base unit. */
  barcode: optionalTrimmed(64),
});
export type CreateProductInput = z.input<typeof createProductSchema>;

export const updateProductSchema = z.object({
  productId: trimmed(40),
  fields: productFieldsSchema,
});
export type UpdateProductInput = z.input<typeof updateProductSchema>;

export const setPriceSchema = z.object({
  productId: trimmed(40),
  unitId: trimmed(40),
  priceMinor: z.number().int().min(0),
});
export type SetPriceInput = z.infer<typeof setPriceSchema>;

export const addUnitSchema = z.object({
  productId: trimmed(40),
  name: trimmed(40),
  factorToBase: z.number().int().min(1).max(1_000_000),
  priceMinor: z.number().int().min(0).optional(),
});
export type AddUnitInput = z.infer<typeof addUnitSchema>;

export const addBarcodeSchema = z.object({
  productId: trimmed(40),
  barcode: trimmed(64).regex(
    /^[0-9A-Za-z._-]+$/,
    "Barcode: digits/letters and '.', '_', '-' only.",
  ),
  unitId: z.string().trim().min(1).nullable().optional(),
});
export type AddBarcodeInput = z.infer<typeof addBarcodeSchema>;

const PRODUCT_FIELD_COLUMNS: [keyof ProductFieldsInput, string][] = [
  ["sku", "sku"],
  ["name", "name"],
  ["genericName", "generic_name"],
  ["strength", "strength"],
  ["form", "form"],
  ["manufacturer", "manufacturer"],
  ["categoryId", "category_id"],
  ["baseUnit", "base_unit"],
  ["taxClassId", "tax_class_id"],
  ["requiresRx", "requires_rx"],
  ["controlledSchedule", "controlled_schedule"],
  ["coldChain", "cold_chain"],
  ["sellableLoose", "sellable_loose"],
  ["storageNotes", "storage_notes"],
  ["reorderLevel", "reorder_level"],
];

async function assertCategoryAndTaxExist(
  tx: { execute: (stmt: { sql: string; args: (string | null)[] }) => Promise<{ rows: unknown[] }> },
  categoryId: string | null | undefined,
  taxClassId: string | null | undefined,
): Promise<void> {
  if (categoryId) {
    const found = await tx.execute({
      sql: "select id from categories where id = ?",
      args: [categoryId],
    });
    if (found.rows.length === 0) throw new DomainError("BAD_CATEGORY", "Unknown category.");
  }
  if (taxClassId) {
    const found = await tx.execute({
      sql: "select id from tax_classes where id = ?",
      args: [taxClassId],
    });
    if (found.rows.length === 0) throw new DomainError("BAD_TAX_CLASS", "Unknown tax class.");
  }
}

export async function createProduct(
  handle: DatabaseHandle,
  actor: SessionUser,
  rawInput: CreateProductInput,
): Promise<{ productId: string; unitId: string }> {
  requireCapability(actor, "catalog.manage");
  const input = createProductSchema.parse(rawInput);
  const productId = newId();
  const unitId = newId();
  const now = Date.now();

  await withWriteTx(handle.client, async (tx) => {
    const duplicate = await tx.execute({
      sql: "select id from products where sku = ?",
      args: [input.sku],
    });
    if (duplicate.rows.length > 0) {
      throw new DomainError("DUPLICATE_SKU", `SKU "${input.sku}" is already in use.`);
    }
    await assertCategoryAndTaxExist(tx, input.categoryId, input.taxClassId);

    await tx.execute({
      sql: `insert into products
            (id, sku, name, generic_name, strength, form, manufacturer, category_id, base_unit,
             tax_class_id, requires_rx, controlled_schedule, cold_chain, sellable_loose,
             storage_notes, reorder_level, active, created_at, updated_at)
            values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`,
      args: [
        productId,
        input.sku,
        input.name,
        input.genericName ?? null,
        input.strength ?? null,
        input.form ?? null,
        input.manufacturer ?? null,
        input.categoryId ?? null,
        input.baseUnit,
        input.taxClassId ?? null,
        input.requiresRx ? 1 : 0,
        input.controlledSchedule ?? null,
        input.coldChain ? 1 : 0,
        input.sellableLoose ? 1 : 0,
        input.storageNotes ?? null,
        input.reorderLevel,
        now,
        now,
      ],
    });

    // Every product gets a base unit (factor 1) as its default sale unit.
    await tx.execute({
      sql: `insert into product_units (id, product_id, name, factor_to_base, is_default_sale, created_at, updated_at)
            values (?,?,?,1,1,?,?)`,
      args: [unitId, productId, input.baseUnit, now, now],
    });
    if (input.priceMinor !== undefined) {
      await tx.execute({
        sql: `insert into product_prices (id, product_id, unit_id, price, effective_from, created_at, updated_at)
              values (?,?,?,?,?,?,?)`,
        args: [newId(), productId, unitId, input.priceMinor, now, now, now],
      });
    }
    if (input.barcode) {
      await tx.execute({
        sql: `insert into product_barcodes (id, barcode, product_id, unit_id, created_at, updated_at)
              values (?,?,?,?,?,?)`,
        args: [newId(), input.barcode, productId, unitId, now, now],
      });
    }

    await tx.execute(
      await buildAuditStatement({
        userId: actor.id,
        action: "product.created",
        entity: "products",
        entityId: productId,
        after: productSnapshot({ ...input, priceMinor: input.priceMinor ?? null }),
      }),
    );
  });

  return { productId, unitId };
}

export async function updateProduct(
  handle: DatabaseHandle,
  actor: SessionUser,
  rawInput: UpdateProductInput,
): Promise<{ changed: boolean }> {
  requireCapability(actor, "catalog.manage");
  const input = updateProductSchema.parse(rawInput);
  const now = Date.now();

  return withWriteTx(handle.client, async (tx) => {
    const current = await tx.execute({
      sql: "select * from products where id = ?",
      args: [input.productId],
    });
    if (current.rows.length === 0) {
      throw new DomainError("NOT_FOUND", "Product not found.");
    }
    await assertCategoryAndTaxExist(tx, input.fields.categoryId, input.fields.taxClassId);

    const before: Record<string, JsonValue> = {};
    const after: Record<string, JsonValue> = {};
    const sets: string[] = [];
    const args: (string | number | null)[] = [];

    for (const [field, column] of PRODUCT_FIELD_COLUMNS) {
      const next = input.fields[field] ?? null;
      const previous = (current.rows[0] as Record<string, unknown>)[column];
      const normalized = previous === null || previous === undefined ? null : previous;
      if (normalized !== next) {
        before[column] = normalized as JsonValue;
        after[column] = next as JsonValue;
        sets.push(`${column} = ?`);
        args.push(next as string | number | null);
      }
    }
    if (sets.length === 0) return { changed: false };

    if (before.sku !== undefined) {
      const duplicate = await tx.execute({
        sql: "select id from products where sku = ? and id <> ?",
        args: [input.fields.sku, input.productId],
      });
      if (duplicate.rows.length > 0) {
        throw new DomainError("DUPLICATE_SKU", `SKU "${input.fields.sku}" is already in use.`);
      }
    }

    sets.push("updated_at = ?");
    args.push(now, input.productId);
    await tx.execute({
      sql: `update products set ${sets.join(", ")} where id = ?`,
      args,
    });

    await tx.execute(
      await buildAuditStatement({
        userId: actor.id,
        action: "product.updated",
        entity: "products",
        entityId: input.productId,
        before,
        after,
      }),
    );
    return { changed: true };
  });
}

export async function setProductActive(
  handle: DatabaseHandle,
  actor: SessionUser,
  input: { productId: string; active: boolean },
): Promise<void> {
  requireCapability(actor, "catalog.manage");
  const now = Date.now();

  await withWriteTx(handle.client, async (tx) => {
    const current = await tx.execute({
      sql: "select active from products where id = ?",
      args: [input.productId],
    });
    if (current.rows.length === 0) throw new DomainError("NOT_FOUND", "Product not found.");
    const was = Number(current.rows[0].active) === 1;
    if (was === input.active) return;

    await tx.execute({
      sql: "update products set active = ?, updated_at = ? where id = ?",
      args: [input.active ? 1 : 0, now, input.productId],
    });
    await tx.execute(
      await buildAuditStatement({
        userId: actor.id,
        action: input.active ? "product.activated" : "product.deactivated",
        entity: "products",
        entityId: input.productId,
        before: { active: was },
        after: { active: input.active },
      }),
    );
  });
}

/**
 * Closes the open price row for (product, unit) and opens a new one.
 * The unique-open-row invariant is guarded by the `effective_to is null`
 * predicate — a racing writer can only close the row once.
 */
export async function setProductPrice(
  handle: DatabaseHandle,
  actor: SessionUser,
  rawInput: SetPriceInput,
): Promise<{ changed: boolean; previousMinor: number | null }> {
  requireCapability(actor, "price.manage");
  const input = setPriceSchema.parse(rawInput);
  const now = Date.now();

  return withWriteTx(handle.client, async (tx) => {
    const unit = await tx.execute({
      sql: "select id from product_units where id = ? and product_id = ?",
      args: [input.unitId, input.productId],
    });
    if (unit.rows.length === 0) {
      throw new DomainError("NOT_FOUND", "Unit not found for this product.");
    }

    const open = await tx.execute({
      sql: `select id, price from product_prices
            where product_id = ? and unit_id = ? and effective_to is null
            order by effective_from desc limit 1`,
      args: [input.productId, input.unitId],
    });
    const previous = open.rows[0];
    const previousMinor = previous ? Number(previous.price) : null;
    if (previousMinor === input.priceMinor) {
      return { changed: false, previousMinor };
    }

    if (previous) {
      const closed = await tx.execute({
        sql: `update product_prices set effective_to = ?, updated_at = ?
              where id = ? and effective_to is null`,
        args: [now, now, previous.id],
      });
      if (closed.rowsAffected === 0) {
        throw new DomainError(
          "PRICE_RACE",
          "The price was changed concurrently — refresh and try again.",
        );
      }
    }

    await tx.execute({
      sql: `insert into product_prices (id, product_id, unit_id, price, effective_from, created_at, updated_at)
            values (?,?,?,?,?,?,?)`,
      args: [newId(), input.productId, input.unitId, input.priceMinor, now, now, now],
    });

    await tx.execute(
      await buildAuditStatement({
        userId: actor.id,
        action: "product.price_changed",
        entity: "product_prices",
        entityId: input.productId,
        before: { unitId: input.unitId, priceMinor: previousMinor },
        after: { unitId: input.unitId, priceMinor: input.priceMinor },
      }),
    );
    return { changed: true, previousMinor };
  });
}

export async function addProductUnit(
  handle: DatabaseHandle,
  actor: SessionUser,
  rawInput: AddUnitInput,
): Promise<{ unitId: string }> {
  requireCapability(actor, "catalog.manage");
  const input = addUnitSchema.parse(rawInput);
  const unitId = newId();
  const now = Date.now();

  await withWriteTx(handle.client, async (tx) => {
    const product = await tx.execute({
      sql: "select id from products where id = ?",
      args: [input.productId],
    });
    if (product.rows.length === 0) throw new DomainError("NOT_FOUND", "Product not found.");
    const duplicate = await tx.execute({
      sql: "select id from product_units where product_id = ? and name = ?",
      args: [input.productId, input.name],
    });
    if (duplicate.rows.length > 0) {
      throw new DomainError(
        "DUPLICATE_UNIT",
        `Unit "${input.name}" already exists for this product.`,
      );
    }

    await tx.execute({
      sql: `insert into product_units (id, product_id, name, factor_to_base, is_default_sale, created_at, updated_at)
            values (?,?,?,?,0,?,?)`,
      args: [unitId, input.productId, input.name, input.factorToBase, now, now],
    });
    if (input.priceMinor !== undefined) {
      await tx.execute({
        sql: `insert into product_prices (id, product_id, unit_id, price, effective_from, created_at, updated_at)
              values (?,?,?,?,?,?,?)`,
        args: [newId(), input.productId, unitId, input.priceMinor, now, now, now],
      });
    }

    await tx.execute(
      await buildAuditStatement({
        userId: actor.id,
        action: "product.unit_added",
        entity: "product_units",
        entityId: unitId,
        after: {
          productId: input.productId,
          name: input.name,
          factorToBase: input.factorToBase,
          priceMinor: input.priceMinor ?? null,
        },
      }),
    );
  });
  return { unitId };
}

export async function setDefaultSaleUnit(
  handle: DatabaseHandle,
  actor: SessionUser,
  input: { productId: string; unitId: string },
): Promise<void> {
  requireCapability(actor, "catalog.manage");
  const now = Date.now();

  await withWriteTx(handle.client, async (tx) => {
    const unit = await tx.execute({
      sql: "select id, name from product_units where id = ? and product_id = ?",
      args: [input.unitId, input.productId],
    });
    if (unit.rows.length === 0) {
      throw new DomainError("NOT_FOUND", "Unit not found for this product.");
    }

    await tx.execute({
      sql: `update product_units
            set is_default_sale = case when id = ? then 1 else 0 end, updated_at = ?
            where product_id = ?`,
      args: [input.unitId, now, input.productId],
    });
    await tx.execute(
      await buildAuditStatement({
        userId: actor.id,
        action: "product.default_unit_changed",
        entity: "products",
        entityId: input.productId,
        after: { unitId: input.unitId, unitName: String(unit.rows[0].name) },
      }),
    );
  });
}

export async function addBarcode(
  handle: DatabaseHandle,
  actor: SessionUser,
  rawInput: AddBarcodeInput,
): Promise<{ barcodeId: string }> {
  requireCapability(actor, "catalog.manage");
  const input = addBarcodeSchema.parse(rawInput);
  const barcodeId = newId();
  const now = Date.now();

  await withWriteTx(handle.client, async (tx) => {
    const product = await tx.execute({
      sql: "select id from products where id = ?",
      args: [input.productId],
    });
    if (product.rows.length === 0) throw new DomainError("NOT_FOUND", "Product not found.");
    if (input.unitId) {
      const unit = await tx.execute({
        sql: "select id from product_units where id = ? and product_id = ?",
        args: [input.unitId, input.productId],
      });
      if (unit.rows.length === 0) {
        throw new DomainError("BAD_UNIT", "That unit does not belong to this product.");
      }
    }
    const duplicate = await tx.execute({
      sql: "select id, product_id from product_barcodes where barcode = ?",
      args: [input.barcode],
    });
    if (duplicate.rows.length > 0) {
      throw new DomainError(
        "DUPLICATE_BARCODE",
        `Barcode "${input.barcode}" is already assigned to a product.`,
      );
    }

    await tx.execute({
      sql: `insert into product_barcodes (id, barcode, product_id, unit_id, created_at, updated_at)
            values (?,?,?,?,?,?)`,
      args: [newId(), input.barcode, input.productId, input.unitId ?? null, now, now],
    });
    await tx.execute(
      await buildAuditStatement({
        userId: actor.id,
        action: "product.barcode_added",
        entity: "product_barcodes",
        entityId: barcodeId,
        after: { productId: input.productId, barcode: input.barcode, unitId: input.unitId ?? null },
      }),
    );
  });
  return { barcodeId };
}

export async function removeBarcode(
  handle: DatabaseHandle,
  actor: SessionUser,
  input: { barcodeId: string },
): Promise<void> {
  requireCapability(actor, "catalog.manage");

  await withWriteTx(handle.client, async (tx) => {
    const row = await tx.execute({
      sql: "select id, product_id, barcode from product_barcodes where id = ?",
      args: [input.barcodeId],
    });
    if (row.rows.length === 0) throw new DomainError("NOT_FOUND", "Barcode not found.");

    await tx.execute({
      sql: "delete from product_barcodes where id = ?",
      args: [input.barcodeId],
    });
    await tx.execute(
      await buildAuditStatement({
        userId: actor.id,
        action: "product.barcode_removed",
        entity: "product_barcodes",
        entityId: input.barcodeId,
        before: {
          productId: String(row.rows[0].product_id),
          barcode: String(row.rows[0].barcode),
        },
      }),
    );
  });
}

export async function createCategory(
  handle: DatabaseHandle,
  actor: SessionUser,
  input: { name: string },
): Promise<{ categoryId: string; created: boolean }> {
  requireCapability(actor, "catalog.manage");
  const name = input.name.trim();
  if (name.length === 0 || name.length > 80) {
    throw new DomainError("BAD_INPUT", "Category name must be 1–80 characters.");
  }

  return withWriteTx(handle.client, async (tx) => {
    // categories.name is unique case-sensitively; match loosely to avoid
    // "Pain Relief" vs "pain relief" duplicates.
    const existing = await tx.execute({
      sql: "select id from categories where lower(name) = lower(?)",
      args: [name],
    });
    if (existing.rows.length > 0) {
      return { categoryId: String(existing.rows[0].id), created: false };
    }

    const categoryId = newId();
    const now = Date.now();
    await tx.execute({
      sql: "insert into categories (id, name, active, created_at, updated_at) values (?,?,1,?,?)",
      args: [categoryId, name, now, now],
    });
    await tx.execute(
      await buildAuditStatement({
        userId: actor.id,
        action: "category.created",
        entity: "categories",
        entityId: categoryId,
        after: { name },
      }),
    );
    return { categoryId, created: true };
  });
}

function productSnapshot(
  input: Omit<z.output<typeof createProductSchema>, "priceMinor"> & { priceMinor?: number | null },
): Record<string, JsonValue> {
  return {
    sku: input.sku,
    name: input.name,
    genericName: input.genericName ?? null,
    baseUnit: input.baseUnit,
    requiresRx: input.requiresRx,
    controlledSchedule: input.controlledSchedule ?? null,
    coldChain: input.coldChain,
    sellableLoose: input.sellableLoose,
    reorderLevel: input.reorderLevel,
    priceMinor: input.priceMinor ?? null,
  };
}
