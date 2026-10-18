/**
 * Money helpers (spec §5 conventions: integer minor units everywhere).
 *
 * Amounts are stored and computed as integer minor units (centavos). These
 * helpers only handle display and input parsing — never arithmetic on floats.
 */

const CURRENCY_LOCALES: Record<string, string> = {
  PHP: "en-PH",
};

/** Formats integer minor units for display, e.g. 123456 → "₱1,234.56". */
export function formatMinor(amountMinor: number, currency = "PHP"): string {
  return new Intl.NumberFormat(CURRENCY_LOCALES[currency] ?? "en-US", {
    style: "currency",
    currency,
  }).format(amountMinor / 100);
}

/**
 * Parses user input like "1,234.5" into integer minor units.
 * Returns null when the input is not a valid non-negative amount.
 */
export function parseMinor(input: string): number | null {
  const cleaned = input.trim().replaceAll(",", "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, fraction = ""] = cleaned.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0") || "0");
}
