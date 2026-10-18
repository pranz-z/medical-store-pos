import { describe, expect, it } from "vitest";

import { formatMinor, parseMinor } from "@/lib/money";

/**
 * Money is integer minor units everywhere (spec §5 conventions); these helpers
 * are the only place display/input crosses that boundary.
 */

describe("formatMinor", () => {
  it("formats centavos with two decimals and thousands separators", () => {
    const formatted = formatMinor(123_456);
    expect(formatted).toContain("1,234.56");
  });

  it("renders zero with two decimals", () => {
    expect(formatMinor(0)).toContain("0.00");
  });

  it("honours the currency argument", () => {
    expect(formatMinor(5_00, "USD")).toContain("$5.00");
  });
});

describe("parseMinor", () => {
  it("parses plain amounts", () => {
    expect(parseMinor("12")).toBe(1_200);
    expect(parseMinor("12.5")).toBe(1_250);
    expect(parseMinor("12.50")).toBe(1_250);
    expect(parseMinor("0.05")).toBe(5);
  });

  it("tolerates thousands separators and surrounding spaces", () => {
    expect(parseMinor(" 1,234.56 ")).toBe(123_456);
  });

  it("rejects invalid amounts", () => {
    for (const input of ["", " ", ".", ".5", "1.234", "-5", "1e3", "abc", "5.6.7"]) {
      expect(parseMinor(input), `input: ${JSON.stringify(input)}`).toBeNull();
    }
  });
});
