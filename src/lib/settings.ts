import { eq } from "drizzle-orm";

import type { Database } from "@/db/client";
import { settings } from "@/db/schema/system";

/**
 * Typed readers for the `settings` table (spec §5.1).
 *
 * M1 introduces two configurable knobs; both fall back to the defaults below
 * when the row is absent, so a fresh database behaves correctly without seed.
 *
 * - `inventory.min_shelf_life_days`: receiving rejects an expiry date that is
 *   in the past or closer than this many days (spec §6.3.3). Default 90.
 * - `adjustments.step_up_thresholds`: `{ qtyBase, valueMinor }` — an
 *   adjustment whose |qty| >= qtyBase OR whose |qty * cost| >= valueMinor
 *   requires a PIN step-up before it writes. Defaults: 500 base units or
 *   ₱500.00 (50000 minor).
 */

export const MIN_SHELF_LIFE_DAYS_KEY = "inventory.min_shelf_life_days";
export const DEFAULT_MIN_SHELF_LIFE_DAYS = 90;

export const ADJUST_STEP_UP_KEY = "adjustments.step_up_thresholds";
export interface AdjustmentStepUpThresholds {
  qtyBase: number;
  valueMinor: number;
}
export const DEFAULT_ADJUST_STEP_UP: AdjustmentStepUpThresholds = {
  qtyBase: 500,
  valueMinor: 50_000,
};

export async function getMinShelfLifeDays(db: Database): Promise<number> {
  const value = await readSetting(db, MIN_SHELF_LIFE_DAYS_KEY);
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : DEFAULT_MIN_SHELF_LIFE_DAYS;
}

export async function getAdjustmentStepUpThresholds(
  db: Database,
): Promise<AdjustmentStepUpThresholds> {
  const value = await readSetting(db, ADJUST_STEP_UP_KEY);
  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Number.isInteger((value as Record<string, unknown>).qtyBase) &&
    Number.isInteger((value as Record<string, unknown>).valueMinor)
  ) {
    return value as unknown as AdjustmentStepUpThresholds;
  }
  return DEFAULT_ADJUST_STEP_UP;
}

/** True when an adjustment of this size needs a PIN step-up. Pure and testable. */
export function adjustmentNeedsStepUp(
  qtyDeltaBase: number,
  costPerBaseUnitMinor: number,
  thresholds: AdjustmentStepUpThresholds,
): boolean {
  const qty = Math.abs(qtyDeltaBase);
  return qty >= thresholds.qtyBase || qty * costPerBaseUnitMinor >= thresholds.valueMinor;
}

async function readSetting(db: Database, key: string) {
  const rows = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, key))
    .limit(1);
  return rows[0]?.value;
}
