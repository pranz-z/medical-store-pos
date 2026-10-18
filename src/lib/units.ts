/**
 * Unit conversion helpers (spec §5 conventions: quantities are integer base
 * units; `product_units.factor_to_base` converts to/from selling units).
 *
 * `toBaseUnits` is the only place a purchase/selling quantity may cross into
 * base units — keep it that way so stock math stays integer-exact.
 */

export function toBaseUnits(quantity: number, factorToBase: number): number {
  if (!Number.isInteger(quantity) || !Number.isInteger(factorToBase) || factorToBase <= 0) {
    throw new Error("Quantity and factor must be positive integers.");
  }
  return quantity * factorToBase;
}

/** Splits a base quantity into whole selling units plus a remainder. */
export function splitBaseUnits(
  baseQuantity: number,
  factorToBase: number,
): { whole: number; remainder: number } {
  if (!Number.isInteger(baseQuantity) || !Number.isInteger(factorToBase) || factorToBase <= 0) {
    throw new Error("Quantity and factor must be positive integers.");
  }
  return {
    whole: Math.floor(baseQuantity / factorToBase),
    remainder: baseQuantity % factorToBase,
  };
}

/** Unit price for a selling unit, derived from a per-base-unit price. */
export function priceFromBaseUnit(basePriceMinor: number, factorToBase: number): number {
  if (!Number.isInteger(basePriceMinor) || !Number.isInteger(factorToBase) || factorToBase <= 0) {
    throw new Error("Price and factor must be positive integers.");
  }
  return basePriceMinor * factorToBase;
}

/**
 * Cost per base unit derived from a cost quoted per selling unit
 * (spec §6.3: receiving enters cost per box/strip; `batches.cost_per_base_unit`
 * stores per base unit). Integer minor units — the result is rounded to the
 * nearest minor unit when the cost does not divide evenly.
 */
export function costPerBaseUnit(costPerUnitMinor: number, factorToBase: number): number {
  if (!Number.isInteger(costPerUnitMinor) || costPerUnitMinor < 0) {
    throw new Error("Cost must be a non-negative integer minor unit.");
  }
  if (!Number.isInteger(factorToBase) || factorToBase <= 0) {
    throw new Error("Factor must be a positive integer.");
  }
  return Math.round(costPerUnitMinor / factorToBase);
}
