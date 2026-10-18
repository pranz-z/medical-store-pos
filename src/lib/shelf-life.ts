import { addDaysIso } from "@/lib/dates";

/**
 * Receiving shelf-life validation (spec §6.3.3): an incoming batch is rejected
 * when its expiry is in the past or sooner than the configured minimum
 * shelf-life (default 90 days via `inventory.min_shelf_life_days`).
 *
 * Returns an error message, or `null` when the date is acceptable.
 */
export function expiryRejection(
  expiryIso: string,
  todayIso: string,
  minShelfLifeDays: number,
): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiryIso) || !isRealDate(expiryIso)) {
    return "Expiry must be a real calendar date (YYYY-MM-DD).";
  }
  if (expiryIso < todayIso) {
    return "Expiry date is in the past — expired stock cannot be received.";
  }
  const earliest = addDaysIso(todayIso, minShelfLifeDays);
  if (expiryIso < earliest) {
    return `Expiry ${expiryIso} is inside the minimum shelf-life of ${minShelfLifeDays} days (earliest accepted: ${earliest}).`;
  }
  return null;
}

/** Strict calendar-date check: catches 2026-02-30 style fakes. */
export function isRealDate(isoDate: string): boolean {
  const parsed = new Date(`${isoDate}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === isoDate;
}
