import { addDaysIso } from "@/lib/dates";

/**
 * Receiving shelf-life validation (spec §6.3.3): an incoming batch is rejected
 * when its expiry is in the past or sooner than the configured minimum
 * shelf-life (default 90 days via `inventory.min_shelf_life_days`).
 *
 * The result distinguishes the rejection kind because M2's manager-approval
 * override may only bypass `TOO_SOON` — a malformed or past expiry is never
 * receivable.
 */
export type ExpiryRejectionCode = "BAD_FORMAT" | "PAST" | "TOO_SOON";

export interface ExpiryCheck {
  ok: boolean;
  code?: ExpiryRejectionCode;
  message?: string;
}

export function checkExpiry(
  expiryIso: string,
  todayIso: string,
  minShelfLifeDays: number,
): ExpiryCheck {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiryIso) || !isRealDate(expiryIso)) {
    return {
      ok: false,
      code: "BAD_FORMAT",
      message: "Expiry must be a real calendar date (YYYY-MM-DD).",
    };
  }
  if (expiryIso < todayIso) {
    return {
      ok: false,
      code: "PAST",
      message: "Expiry date is in the past — expired stock cannot be received.",
    };
  }
  const earliest = addDaysIso(todayIso, minShelfLifeDays);
  if (expiryIso < earliest) {
    return {
      ok: false,
      code: "TOO_SOON",
      message: `Expiry ${expiryIso} is inside the minimum shelf-life of ${minShelfLifeDays} days (earliest accepted: ${earliest}).`,
    };
  }
  return { ok: true };
}

/** Back-compat wrapper: the rejection message, or `null` when acceptable. */
export function expiryRejection(
  expiryIso: string,
  todayIso: string,
  minShelfLifeDays: number,
): string | null {
  const check = checkExpiry(expiryIso, todayIso, minShelfLifeDays);
  return check.ok ? null : (check.message ?? "Invalid expiry.");
}

/** Strict calendar-date check: catches 2026-02-30 style fakes. */
export function isRealDate(isoDate: string): boolean {
  const parsed = new Date(`${isoDate}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === isoDate;
}
