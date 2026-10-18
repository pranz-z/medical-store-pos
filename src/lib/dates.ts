/**
 * Date helpers. Calendar dates are ISO `YYYY-MM-DD` text in the database and
 * always evaluated in `APP_TIMEZONE` (spec §5 conventions) so "today" means
 * today at the store, not on the server.
 */

/** Today's calendar date (YYYY-MM-DD) in the given IANA timezone. */
export function todayIso(timeZone = "Asia/Manila"): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Adds whole days to an ISO calendar date and returns a new ISO date. */
export function addDaysIso(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
