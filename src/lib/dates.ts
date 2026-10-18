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

/** Milliseconds between the IANA timezone's wall clock and UTC at an instant. */
function tzOffsetMs(timeZone: string, atMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(atMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asIfUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") === 24 ? 0 : get("hour"),
    get("minute"),
    get("second"),
  );
  return asIfUtc - atMs;
}

/**
 * UTC epoch-ms bounds `[start, end)` for one calendar date in the timezone —
 * DST-safe because the offset is resolved at the day boundary itself.
 */
export function calendarDayRangeUtc(
  isoDate: string,
  timeZone = "Asia/Manila",
): { startMs: number; endMs: number } {
  const [y, m, d] = isoDate.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  const startMs = guess - tzOffsetMs(timeZone, guess);
  const next = guess + 86_400_000;
  const endMs = next - tzOffsetMs(timeZone, next);
  return { startMs, endMs };
}
