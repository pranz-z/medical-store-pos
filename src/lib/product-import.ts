import type { DatabaseHandle } from "@/db/client";
import { buildAuditStatement } from "@/lib/audit";
import type { SessionUser } from "@/lib/auth/session";
import { DomainError } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { requireCapability } from "@/lib/permissions";
import {
  IMPORT_MAX_ROWS,
  type ImportLookups,
  type ImportRowResult,
  type ImportValidation,
  type ValidatedImportProduct,
} from "@/lib/product-import-shared";
import { withWriteTx } from "@/lib/tx";

/**
 * CSV product import (spec §3.2 "bulk import/export via CSV with validation
 * preview"). Pure validation (`validateImportRows`) is shared by the dry-run
 * and the commit path — the commit re-validates everything, so a client can
 * never slip an unvalidated row through.
 *
 * Row model: one row = one product + one selling unit priced per unit. The
 * unit defaults to the product's `base_unit` (factor 1, default sale unit).
 * Categories are matched case-insensitively and auto-created on commit;
 * `tax_class` must name an existing tax class.
 *
 * Constants/types live in `product-import-shared.ts` (client-safe) and are
 * re-exported here so server callers keep a single import site.
 */

export {
  IMPORT_COLUMNS,
  IMPORT_MAX_BYTES,
  IMPORT_MAX_ROWS,
  IMPORT_TEMPLATE,
} from "@/lib/product-import-shared";
export type {
  ImportLookups,
  ImportRowResult,
  ImportValidation,
  ValidatedImportProduct,
} from "@/lib/product-import-shared";

const BOOL_TRUE = new Set(["true", "yes", "1", "y"]);
const BOOL_FALSE = new Set(["false", "no", "0", "n", ""]);

function parseBool(value: string, field: string, errors: string[], fallback: boolean): boolean {
  const normalized = value.trim().toLowerCase();
  if (BOOL_TRUE.has(normalized)) return true;
  if (BOOL_FALSE.has(normalized)) return value.trim() === "" ? fallback : false;
  errors.push(`${field}: expected yes/no/true/false, got "${value}".`);
  return fallback;
}

function parseIntField(
  value: string,
  field: string,
  errors: string[],
  opts: { required?: boolean; min?: number; max?: number; fallback?: number },
): number | null {
  const trimmed = value.trim();
  if (trimmed === "") {
    if (opts.required) errors.push(`${field}: required.`);
    return opts.fallback ?? null;
  }
  if (!/^-?\d+$/.test(trimmed)) {
    errors.push(`${field}: must be a whole number, got "${value}".`);
    return null;
  }
  const parsed = Number(trimmed);
  if (opts.min !== undefined && parsed < opts.min) {
    errors.push(`${field}: must be >= ${opts.min}.`);
    return null;
  }
  if (opts.max !== undefined && parsed > opts.max) {
    errors.push(`${field}: must be <= ${opts.max}.`);
    return null;
  }
  return parsed;
}

function trimmedField(record: Record<string, string>, field: string, max: number): string | null {
  const value = (record[field] ?? "").trim();
  if (value === "") return null;
  return value.length > max ? value.slice(0, max) : value;
}

export function validateImportRows(
  records: { line: number; record: Record<string, string> }[],
  lookups: ImportLookups,
): ImportValidation {
  const valid: ValidatedImportProduct[] = [];
  const rows: ImportRowResult[] = [];
  const seenSkus = new Set<string>();
  const seenBarcodes = new Set<string>();

  for (const { line, record } of records) {
    const errors: string[] = [];
    const sku = (record.sku ?? "").trim();
    const name = (record.name ?? "").trim();

    if (!/^[A-Za-z0-9._-]{1,64}$/.test(sku)) {
      errors.push("sku: required; letters, digits, '.', '_' and '-' only (max 64).");
    }
    if (name.length === 0) errors.push("name: required.");
    if (name.length > 200) errors.push("name: max 200 characters.");

    const skuKey = sku.toLowerCase();
    if (skuKey.length > 0) {
      if (seenSkus.has(skuKey)) errors.push(`sku: "${sku}" is duplicated in this file.`);
      if (lookups.skus.has(skuKey)) errors.push(`sku: "${sku}" already exists in the catalog.`);
      seenSkus.add(skuKey);
    }

    const baseUnit = (record.base_unit ?? "").trim();
    if (baseUnit.length === 0) errors.push("base_unit: required (e.g. tablet, ml, sachet).");

    let taxClassId: string | null = null;
    const taxName = (record.tax_class ?? "").trim();
    if (taxName.length > 0) {
      const hit = lookups.taxClassesByName.get(taxName.toLowerCase());
      if (!hit) {
        errors.push(`tax_class: "${taxName}" is not a known tax class.`);
      } else {
        taxClassId = hit.id;
      }
    }

    const categoryName = trimmedField(record, "category", 80);
    const barcode = trimmedField(record, "barcode", 64);
    if (barcode !== null) {
      if (!/^[0-9A-Za-z._-]+$/.test(barcode)) {
        errors.push("barcode: digits/letters and '.', '_', '-' only.");
      }
      if (seenBarcodes.has(barcode.toLowerCase())) {
        errors.push(`barcode: "${barcode}" is duplicated in this file.`);
      }
      if (lookups.barcodes.has(barcode)) {
        errors.push(`barcode: "${barcode}" is already assigned.`);
      }
      seenBarcodes.add(barcode.toLowerCase());
    }

    const reorderLevel = parseIntField(record.reorder_level ?? "", "reorder_level", errors, {
      min: 0,
      max: 1_000_000,
      fallback: 0,
    });
    const priceMinor = parseIntField(record.price_minor ?? "", "price_minor", errors, {
      required: true,
      min: 0,
      max: 1_000_000_000,
    });

    const requiresRx = parseBool(record.requires_rx ?? "", "requires_rx", errors, false);
    const coldChain = parseBool(record.cold_chain ?? "", "cold_chain", errors, false);
    const sellableLoose = parseBool(record.sellable_loose ?? "", "sellable_loose", errors, true);

    if (errors.length === 0 && priceMinor !== null && reorderLevel !== null) {
      valid.push({
        line,
        sku,
        name,
        genericName: trimmedField(record, "generic_name", 200),
        strength: trimmedField(record, "strength", 80),
        form: trimmedField(record, "form", 60),
        manufacturer: trimmedField(record, "manufacturer", 120),
        categoryName,
        baseUnit,
        taxClassId,
        requiresRx,
        controlledSchedule: trimmedField(record, "controlled_schedule", 60),
        coldChain,
        sellableLoose,
        reorderLevel,
        priceMinor,
        barcode,
      });
    }

    rows.push({ line, sku, name, ok: errors.length === 0, errors });
  }

  return { valid, rows };
}

/** Loads the lookup sets validation needs (called once per dry-run/commit). */
export async function loadImportLookups(handle: DatabaseHandle): Promise<ImportLookups> {
  const [skuRows, barcodeRows, taxRows, categoryRows] = await Promise.all([
    handle.client.execute("select lower(sku) as sku from products"),
    handle.client.execute("select barcode from product_barcodes"),
    handle.client.execute("select id, name from tax_classes where active = 1"),
    handle.client.execute("select id, name from categories where active = 1"),
  ]);
  return {
    skus: new Set(skuRows.rows.map((row) => String(row.sku))),
    barcodes: new Set(barcodeRows.rows.map((row) => String(row.barcode))),
    taxClassesByName: new Map(
      taxRows.rows.map((row) => [
        String(row.name).toLowerCase(),
        { id: String(row.id), name: String(row.name) },
      ]),
    ),
    categoriesByName: new Map(
      categoryRows.rows.map((row) => [
        String(row.name).toLowerCase(),
        { id: String(row.id), name: String(row.name) },
      ]),
    ),
  };
}

export interface ImportCommitResult {
  created: number;
  categoriesCreated: number;
}

/** Commits a fully validated set of rows in one transaction (all or nothing). */
export async function commitImport(
  handle: DatabaseHandle,
  actor: SessionUser,
  valid: ValidatedImportProduct[],
): Promise<ImportCommitResult> {
  requireCapability(actor, "catalog.import");
  if (valid.length === 0) {
    throw new DomainError("EMPTY_IMPORT", "Nothing to import.");
  }
  if (valid.length > IMPORT_MAX_ROWS) {
    throw new DomainError("TOO_MANY_ROWS", `Import is capped at ${IMPORT_MAX_ROWS} rows.`);
  }
  const now = Date.now();

  return withWriteTx(handle.client, async (tx) => {
    // Resolve categories case-insensitively; create the ones we don't have yet.
    const categoryRows = await tx.execute({
      sql: "select id, name from categories",
      args: [],
    });
    const categoriesByName = new Map(
      categoryRows.rows.map((row) => [String(row.name).toLowerCase(), String(row.id)]),
    );
    let categoriesCreated = 0;
    for (const product of valid) {
      const key = product.categoryName?.toLowerCase();
      if (key && !categoriesByName.has(key)) {
        const categoryId = newId();
        await tx.execute({
          sql: "insert into categories (id, name, active, created_at, updated_at) values (?,?,1,?,?)",
          args: [categoryId, product.categoryName, now, now],
        });
        categoriesByName.set(key, categoryId);
        categoriesCreated += 1;
      }
    }

    // Defence in depth: re-check uniqueness inside the transaction so two
    // racing imports can't interleave.
    for (const product of valid) {
      const dupSku = await tx.execute({
        sql: "select id from products where sku = ?",
        args: [product.sku],
      });
      if (dupSku.rows.length > 0) {
        throw new DomainError(
          "DUPLICATE_SKU",
          `SKU "${product.sku}" appeared before commit — re-run the import.`,
        );
      }
      if (product.barcode) {
        const dupBarcode = await tx.execute({
          sql: "select id from product_barcodes where barcode = ?",
          args: [product.barcode],
        });
        if (dupBarcode.rows.length > 0) {
          throw new DomainError(
            "DUPLICATE_BARCODE",
            `Barcode "${product.barcode}" appeared before commit — re-run the import.`,
          );
        }
      }
    }

    for (const product of valid) {
      const productId = newId();
      const unitId = newId();
      const categoryId = product.categoryName
        ? (categoriesByName.get(product.categoryName.toLowerCase()) ?? null)
        : null;

      await tx.execute({
        sql: `insert into products
              (id, sku, name, generic_name, strength, form, manufacturer, category_id, base_unit,
               tax_class_id, requires_rx, controlled_schedule, cold_chain, sellable_loose,
               reorder_level, active, created_at, updated_at)
              values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`,
        args: [
          productId,
          product.sku,
          product.name,
          product.genericName,
          product.strength,
          product.form,
          product.manufacturer,
          categoryId,
          product.baseUnit,
          product.taxClassId,
          product.requiresRx ? 1 : 0,
          product.controlledSchedule,
          product.coldChain ? 1 : 0,
          product.sellableLoose ? 1 : 0,
          product.reorderLevel,
          now,
          now,
        ],
      });
      await tx.execute({
        sql: `insert into product_units (id, product_id, name, factor_to_base, is_default_sale, created_at, updated_at)
              values (?,?,?,1,1,?,?)`,
        args: [unitId, productId, product.baseUnit, now, now],
      });
      await tx.execute({
        sql: `insert into product_prices (id, product_id, unit_id, price, effective_from, created_at, updated_at)
              values (?,?,?,?,?,?,?)`,
        args: [newId(), productId, unitId, product.priceMinor, now, now, now],
      });
      if (product.barcode) {
        await tx.execute({
          sql: `insert into product_barcodes (id, barcode, product_id, unit_id, created_at, updated_at)
                values (?,?,?,?,?,?)`,
          args: [newId(), product.barcode, productId, unitId, now, now],
        });
      }
    }

    await tx.execute(
      await buildAuditStatement({
        userId: actor.id,
        action: "product.imported",
        entity: "products",
        after: { created: valid.length, categoriesCreated },
      }),
    );

    return { created: valid.length, categoriesCreated };
  });
}
