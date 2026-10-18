import { describe, expect, it } from "vitest";

import { validateImportRows, type ImportLookups } from "@/lib/product-import";

const emptyLookups = (): ImportLookups => ({
  skus: new Set(),
  barcodes: new Set(),
  taxClassesByName: new Map([["vat-exempt", { id: "tax-1", name: "VAT-exempt" }]]),
  categoriesByName: new Map(),
});

const row = (line: number, record: Record<string, string>) => ({ line, record });

const validRecord: Record<string, string> = {
  sku: "MED-1",
  name: "Paracetamol 500 mg",
  base_unit: "tablet",
  tax_class: "VAT-exempt",
  price_minor: "250",
};

describe("validateImportRows", () => {
  it("accepts a well-formed row and normalizes it", () => {
    const { valid, rows } = validateImportRows([row(2, validRecord)], emptyLookups());
    expect(rows).toEqual([
      { line: 2, sku: "MED-1", name: "Paracetamol 500 mg", ok: true, errors: [] },
    ]);
    expect(valid).toHaveLength(1);
    expect(valid[0]).toMatchObject({
      sku: "MED-1",
      name: "Paracetamol 500 mg",
      baseUnit: "tablet",
      taxClassId: "tax-1",
      priceMinor: 250,
      requiresRx: false,
      coldChain: false,
      sellableLoose: true,
      reorderLevel: 0,
    });
  });

  it("flags every invalid row without blocking valid ones", () => {
    const { valid, rows } = validateImportRows(
      [
        row(2, { ...validRecord, sku: "" }),
        row(3, validRecord),
        row(4, { ...validRecord, sku: "MED-2", price_minor: "12.5" }),
      ],
      emptyLookups(),
    );
    expect(valid).toHaveLength(1);
    expect(rows.map((r) => r.ok)).toEqual([false, true, false]);
    expect(rows[0].errors[0]).toMatch(/sku/i);
    expect(rows[2].errors[0]).toMatch(/price_minor/i);
  });

  it("rejects duplicate SKUs inside the file and against the catalog", () => {
    const lookups = emptyLookups();
    lookups.skus.add("med-9");
    const { rows } = validateImportRows(
      [
        row(2, { ...validRecord, sku: "MED-9" }),
        row(3, { ...validRecord, sku: "DUP-1" }),
        row(4, { ...validRecord, sku: "dup-1" }),
      ],
      lookups,
    );
    expect(rows[0].errors.join(" ")).toMatch(/already exists/);
    expect(rows[1].ok).toBe(true);
    expect(rows[2].errors.join(" ")).toMatch(/duplicated in this file/);
  });

  it("rejects duplicate/assigned barcodes", () => {
    const lookups = emptyLookups();
    lookups.barcodes.add("4800000000001");
    const { rows } = validateImportRows(
      [
        row(2, { ...validRecord, barcode: "4800000000001" }),
        row(3, { ...validRecord, sku: "S-2", barcode: "X-1" }),
        row(4, { ...validRecord, sku: "S-3", barcode: "x-1" }),
      ],
      lookups,
    );
    expect(rows[0].errors.join(" ")).toMatch(/already assigned/);
    expect(rows[2].errors.join(" ")).toMatch(/duplicated in this file/);
  });

  it("rejects unknown tax classes and bad booleans", () => {
    const { rows } = validateImportRows(
      [
        row(2, { ...validRecord, tax_class: "No such class" }),
        row(3, { ...validRecord, sku: "S-2", requires_rx: "maybe" }),
      ],
      emptyLookups(),
    );
    expect(rows[0].errors.join(" ")).toMatch(/tax_class/);
    expect(rows[1].errors.join(" ")).toMatch(/requires_rx/);
  });

  it("rejects missing required fields and out-of-range integers", () => {
    const { rows } = validateImportRows(
      [row(2, { sku: "S-1", name: "", base_unit: "", price_minor: "-5" })],
      emptyLookups(),
    );
    const messages = rows[0].errors.join(" ");
    expect(messages).toMatch(/name: required/);
    expect(messages).toMatch(/base_unit: required/);
    expect(messages).toMatch(/price_minor/);
  });
});
