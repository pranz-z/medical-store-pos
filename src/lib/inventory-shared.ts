/**
 * Shared inventory constants, importable from client and server modules.
 * Adjustment reason codes (spec §3.3) are needed by the server mutation layer
 * (Zod enum) and the client form (select options) alike.
 */

export const ADJUST_REASONS = [
  "damage",
  "expiry_writeoff",
  "count_correction",
  "theft",
  "sample",
] as const;
export type AdjustReason = (typeof ADJUST_REASONS)[number];

/**
 * Canonical approval payloads for inventory actions. The server recomputes
 * these from the parsed mutation input when consuming the token, so the
 * client MUST build them with the same builder (trims are applied here so
 * pre-parse and post-parse shapes match).
 */
export function adjustmentApprovalPayload(input: {
  batchId: string;
  reason: AdjustReason;
  qtyDeltaBase: number;
  notes?: string | null;
}) {
  return {
    batchId: input.batchId.trim(),
    reason: input.reason,
    qtyDeltaBase: input.qtyDeltaBase,
    notes: input.notes?.trim() ? input.notes.trim() : null,
  };
}

export interface ReceiveLinePayloadShape {
  productId: string;
  unitId: string;
  batchNo: string;
  expiryDate: string;
  qty: number;
  unitCostMinor: number;
}

export function receivingApprovalPayload(input: {
  supplierId?: string | null;
  reference?: string | null;
  lines: ReceiveLinePayloadShape[];
}) {
  return {
    supplierId: input.supplierId?.trim() ? input.supplierId.trim() : null,
    reference: input.reference?.trim() ? input.reference.trim() : null,
    lines: input.lines.map((line) => ({
      productId: line.productId.trim(),
      unitId: line.unitId.trim(),
      batchNo: line.batchNo.trim(),
      expiryDate: line.expiryDate.trim(),
      qty: line.qty,
      unitCostMinor: line.unitCostMinor,
    })),
  };
}
