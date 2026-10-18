/**
 * Shared constants and types for the CSV product import (spec §3.2).
 *
 * This module is deliberately dependency-free so it can be imported from
 * client components (the import form) and server modules (the importer,
 * actions, template route) alike. Server-only logic lives in
 * `product-import.ts`; do not add imports here.
 */

export const IMPORT_MAX_BYTES = 256 * 1024;
export const IMPORT_MAX_ROWS = 500;

export const IMPORT_COLUMNS = [
  "sku",
  "name",
  "generic_name",
  "strength",
  "form",
  "manufacturer",
  "category",
  "base_unit",
  "tax_class",
  "requires_rx",
  "controlled_schedule",
  "cold_chain",
  "sellable_loose",
  "reorder_level",
  "price_minor",
  "barcode",
] as const;

export const IMPORT_TEMPLATE =
  `${IMPORT_COLUMNS.join(",")}\n` +
  "MED-9001,Paracetamol 500 mg Tablet,Paracetamol,500 mg,tablet,Unilab,Pain Relief,tablet,VAT-exempt,no,,no,yes,200,250,4800000000001\n";

export interface ValidatedImportProduct {
  line: number;
  sku: string;
  name: string;
  genericName: string | null;
  strength: string | null;
  form: string | null;
  manufacturer: string | null;
  categoryName: string | null;
  baseUnit: string;
  taxClassId: string | null;
  requiresRx: boolean;
  controlledSchedule: string | null;
  coldChain: boolean;
  sellableLoose: boolean;
  reorderLevel: number;
  priceMinor: number;
  barcode: string | null;
}

export interface ImportRowResult {
  line: number;
  sku: string;
  name: string;
  ok: boolean;
  errors: string[];
}

export interface ImportValidation {
  valid: ValidatedImportProduct[];
  rows: ImportRowResult[];
}

export interface ImportLookups {
  /** Existing product SKUs (lowercase). */
  skus: Set<string>;
  /** Existing barcodes. */
  barcodes: Set<string>;
  /** Tax classes keyed by lowercase name. */
  taxClassesByName: Map<string, { id: string; name: string }>;
  /** Categories keyed by lowercase name. */
  categoriesByName: Map<string, { id: string; name: string }>;
}
