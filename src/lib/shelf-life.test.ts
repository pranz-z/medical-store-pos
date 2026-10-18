import { describe, expect, it } from "vitest";

import { expiryRejection } from "@/lib/shelf-life";

const TODAY = "2026-02-10";
const MIN_DAYS = 90;

describe("expiryRejection", () => {
  it("accepts an expiry beyond the minimum shelf-life", () => {
    expect(expiryRejection("2026-08-01", TODAY, MIN_DAYS)).toBeNull();
    // Exactly 90 days out is the boundary — still acceptable.
    expect(expiryRejection("2026-05-11", TODAY, MIN_DAYS)).toBeNull();
  });

  it("rejects an expiry inside the minimum shelf-life", () => {
    const message = expiryRejection("2026-03-01", TODAY, MIN_DAYS);
    expect(message).toMatch(/minimum shelf-life/i);
    expect(message).toContain("90");
  });

  it("rejects an expiry in the past", () => {
    expect(expiryRejection("2026-02-09", TODAY, MIN_DAYS)).toMatch(/past/i);
    expect(expiryRejection("2020-01-01", TODAY, MIN_DAYS)).toMatch(/past/i);
  });

  it("rejects malformed and impossible dates", () => {
    expect(expiryRejection("10-02-2026", TODAY, MIN_DAYS)).toMatch(/YYYY-MM-DD/);
    expect(expiryRejection("2026-02-30", TODAY, MIN_DAYS)).toMatch(/real calendar date/i);
    expect(expiryRejection("2026-13-01", TODAY, MIN_DAYS)).toMatch(/real calendar date/i);
    expect(expiryRejection("", TODAY, MIN_DAYS)).toMatch(/YYYY-MM-DD/);
  });

  it("honours a zero minimum (only the past is rejected)", () => {
    expect(expiryRejection(TODAY, TODAY, 0)).toBeNull();
  });
});
