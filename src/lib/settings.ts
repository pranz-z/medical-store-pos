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

// ---- M2 POS settings (spec §3.1) -------------------------------------------

/** Max manual discount (percent of line/cart subtotal) without an approval token. */
export const DISCOUNT_MAX_PCT_KEY = "pos.discount_max_pct";
export const DEFAULT_DISCOUNT_MAX_PCT = 20;

/**
 * Cash rounding for the payable total (spec §6.1.3). `incrementMinor` is the
 * rounding step in minor units (25 = ₱0.25). `enabled: false` = no rounding.
 */
export const CASH_ROUNDING_KEY = "pos.cash_rounding";
export interface CashRounding {
  enabled: boolean;
  incrementMinor: number;
}
export const DEFAULT_CASH_ROUNDING: CashRounding = { enabled: false, incrementMinor: 25 };

/** POS line warning when the FEFO batch expires within this many days. */
export const NEAR_EXPIRY_WARN_KEY = "pos.near_expiry_warn_days";
export const DEFAULT_NEAR_EXPIRY_WARN_DAYS = 30;

export async function getDiscountMaxPct(db: Database): Promise<number> {
  const value = await readSetting(db, DISCOUNT_MAX_PCT_KEY);
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100
    ? value
    : DEFAULT_DISCOUNT_MAX_PCT;
}

export async function getCashRounding(db: Database): Promise<CashRounding> {
  const value = await readSetting(db, CASH_ROUNDING_KEY);
  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).enabled === "boolean" &&
    Number.isInteger((value as Record<string, unknown>).incrementMinor)
  ) {
    return value as unknown as CashRounding;
  }
  return DEFAULT_CASH_ROUNDING;
}

export async function getNearExpiryWarnDays(db: Database): Promise<number> {
  const value = await readSetting(db, NEAR_EXPIRY_WARN_KEY);
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : DEFAULT_NEAR_EXPIRY_WARN_DAYS;
}

/** Rounds `amount` to the nearest multiple of `increment` (half-up). 0 increment = unchanged. */
export function applyCashRounding(amountMinor: number, rounding: CashRounding): number {
  if (!rounding.enabled || rounding.incrementMinor <= 0) return amountMinor;
  return Math.round(amountMinor / rounding.incrementMinor) * rounding.incrementMinor;
}

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
