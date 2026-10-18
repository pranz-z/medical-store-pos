import { describe, expect, it } from "vitest";

import { priceFromBaseUnit, splitBaseUnits, toBaseUnits } from "@/lib/units";

describe("toBaseUnits", () => {
  it("multiplies whole selling units by the factor", () => {
    expect(toBaseUnits(3, 10)).toBe(30);
    expect(toBaseUnits(1, 1)).toBe(1);
  });

  it("rejects non-integer or nonsensical input", () => {
    expect(() => toBaseUnits(1.5, 10)).toThrow();
    expect(() => toBaseUnits(3, 0)).toThrow();
    expect(() => toBaseUnits(3, -1)).toThrow();
    expect(() => toBaseUnits(3, 2.5)).toThrow();
  });
});

describe("splitBaseUnits", () => {
  it("splits into whole units plus remainder", () => {
    expect(splitBaseUnits(23, 10)).toEqual({ whole: 2, remainder: 3 });
    expect(splitBaseUnits(30, 10)).toEqual({ whole: 3, remainder: 0 });
    expect(splitBaseUnits(0, 10)).toEqual({ whole: 0, remainder: 0 });
  });

  it("rejects invalid input", () => {
    expect(() => splitBaseUnits(10, 0)).toThrow();
    expect(() => splitBaseUnits(1.5, 10)).toThrow();
  });
});

describe("priceFromBaseUnit", () => {
  it("scales a base price up to selling-unit price", () => {
    expect(priceFromBaseUnit(250, 10)).toBe(2_500);
    expect(priceFromBaseUnit(0, 10)).toBe(0);
  });

  it("rejects invalid input", () => {
    expect(() => priceFromBaseUnit(250, 0)).toThrow();
    expect(() => priceFromBaseUnit(1.5, 10)).toThrow();
  });
});
