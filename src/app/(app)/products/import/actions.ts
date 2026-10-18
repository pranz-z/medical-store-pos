"use server";

import { revalidatePath } from "next/cache";

import { getDatabase } from "@/db/client";
import { requireUser } from "@/lib/authz";
import { csvRecords, parseCsv } from "@/lib/csv";
import { DomainError } from "@/lib/errors";
import {
  commitImport,
  IMPORT_MAX_BYTES,
  IMPORT_MAX_ROWS,
  IMPORT_COLUMNS,
  loadImportLookups,
  validateImportRows,
  type ImportRowResult,
} from "@/lib/product-import";

export interface DryRunResult {
  status: "ok" | "error";
  message?: string;
  rows?: ImportRowResult[];
  validCount?: number;
  invalidCount?: number;
}

export interface CommitResult {
  status: "ok" | "error";
  message?: string;
  created?: number;
  rows?: ImportRowResult[];
}

/** Shared parse + cap + validate pipeline. Both actions run it — commit re-validates. */
async function validateCsv(csvText: string) {
  const actor = await requireUser();
  const handle = getDatabase();

  const bytes = new TextEncoder().encode(csvText).length;
  if (bytes > IMPORT_MAX_BYTES) {
    throw new DomainError(
      "TOO_LARGE",
      `File is ${Math.ceil(bytes / 1024)} KB — the cap is ${IMPORT_MAX_BYTES / 1024} KB.`,
    );
  }

  const mapped = csvRecords(parseCsv(csvText));
  if ("error" in mapped) throw new DomainError("BAD_CSV", mapped.error);
  if (mapped.records.length === 0) {
    throw new DomainError("EMPTY", "The file has a header but no data rows.");
  }
  if (mapped.records.length > IMPORT_MAX_ROWS) {
    throw new DomainError(
      "TOO_MANY_ROWS",
      `${mapped.records.length} data rows — the cap is ${IMPORT_MAX_ROWS}.`,
    );
  }

  const unknown = mapped.header.filter(
    (column) => !(IMPORT_COLUMNS as readonly string[]).includes(column),
  );
  if (unknown.length > 0) {
    throw new DomainError(
      "BAD_HEADER",
      `Unknown column(s): ${unknown.join(", ")}. Download the template for the expected header.`,
    );
  }

  const lookups = await loadImportLookups(handle);
  return { actor, handle, validation: validateImportRows(mapped.records, lookups) };
}

function toError(error: unknown): { status: "error"; message: string } {
  if (error instanceof DomainError) return { status: "error", message: error.message };
  throw error;
}

/** Preview: parse and validate every row, return per-row errors. Writes nothing. */
export async function dryRunImportAction(csvText: string): Promise<DryRunResult> {
  try {
    const { validation } = await validateCsv(csvText);
    const invalidCount = validation.rows.filter((row) => !row.ok).length;
    return {
      status: "ok",
      rows: validation.rows,
      validCount: validation.valid.length,
      invalidCount,
    };
  } catch (error) {
    return toError(error);
  }
}

/**
 * Commit: re-validates the entire file server-side, then writes every row in
 * one transaction. Any invalid row aborts the whole import (all or nothing).
 */
export async function commitImportAction(csvText: string): Promise<CommitResult> {
  try {
    const { actor, handle, validation } = await validateCsv(csvText);
    const invalid = validation.rows.filter((row) => !row.ok);
    if (invalid.length > 0) {
      return {
        status: "error",
        message: `${invalid.length} row(s) failed validation — fix them and re-upload. Nothing was imported.`,
        rows: validation.rows,
      };
    }

    const result = await commitImport(handle, actor, validation.valid);
    revalidatePath("/products");
    return { status: "ok", created: result.created };
  } catch (error) {
    return toError(error);
  }
}
