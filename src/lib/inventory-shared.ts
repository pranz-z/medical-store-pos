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
