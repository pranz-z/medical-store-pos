import type { Client } from "@libsql/client";

/**
 * FEFO (first-expiry-first-out) allocation (spec §FR-POS-7, §6.1.4).
 *
 * `allocateFefo` is a pure function over already-fetched candidates; M2's
 * checkout calls `fetchFefoCandidates` then this to decide which batches a
 * sale draws from. A product's expiry date is a calendar date: a batch is
 * sellable while `expiry_date >= today` in `APP_TIMEZONE` — anything earlier
 * is expired and is skipped even when stock remains.
 *
 * Returns `null` when usable stock cannot cover the request; callers translate
 * that into a `STOCK_CHANGED`-style error rather than partially allocating.
 */

export interface FefoCandidate {
  batchId: string;
  /** `YYYY-MM-DD`. */
  expiryDate: string;
  /** On-hand base units (may include expired rows; filtering happens here). */
  qtyRemaining: number;
}

export interface FefoAllocation {
  batchId: string;
  expiryDate: string;
  /** Base units to draw from this batch. */
  qtyBase: number;
}

export function allocateFefo(
  candidates: FefoCandidate[],
  qtyBase: number,
  todayIso: string,
): FefoAllocation[] | null {
  if (!Number.isInteger(qtyBase) || qtyBase <= 0) {
    throw new Error("FEFO quantity must be a positive integer.");
  }

  const usable = candidates
    .filter((c) => c.qtyRemaining > 0 && c.expiryDate >= todayIso)
    .sort((a, b) => (a.expiryDate < b.expiryDate ? -1 : a.expiryDate > b.expiryDate ? 1 : 0));

  let remaining = qtyBase;
  const allocations: FefoAllocation[] = [];
  for (const candidate of usable) {
    const take = Math.min(candidate.qtyRemaining, remaining);
    allocations.push({
      batchId: candidate.batchId,
      expiryDate: candidate.expiryDate,
      qtyBase: take,
    });
    remaining -= take;
    if (remaining === 0) return allocations;
  }
  return null;
}

/**
 * Loads a product's batches at a branch in expiry order for FEFO allocation.
 * Not filtered by expiry here — `allocateFefo` skips expired rows so callers
 * can also report what was skipped.
 */
export async function fetchFefoCandidates(
  client: Client,
  productId: string,
  branchId: string,
): Promise<FefoCandidate[]> {
  const response = await client.execute({
    sql: `select id, expiry_date, qty_remaining
          from batches
          where product_id = ? and branch_id = ? and qty_remaining > 0
          order by expiry_date asc`,
    args: [productId, branchId],
  });
  return response.rows.map((row) => ({
    batchId: String(row.id),
    expiryDate: String(row.expiry_date),
    qtyRemaining: Number(row.qty_remaining),
  }));
}
