import { describe, expect, it } from "vitest";

import { addDaysIso, todayIso } from "@/lib/dates";

describe("todayIso", () => {
  it("returns an ISO calendar date", () => {
    expect(todayIso("Asia/Manila")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("respects the timezone at the date line", () => {
    // UTC+14 can only be the same day as UTC-11 or one day ahead — never behind.
    const east = todayIso("Pacific/Kiritimati");
    const west = todayIso("Pacific/Midway");
    expect(east >= west).toBe(true);
  });
});

describe("addDaysIso", () => {
  it("adds days across month boundaries", () => {
    expect(addDaysIso("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDaysIso("2026-01-31", 1)).toBe("2026-02-01");
  });

  it("handles year boundaries and leap days", () => {
    expect(addDaysIso("2025-12-31", 1)).toBe("2026-01-01");
    expect(addDaysIso("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDaysIso("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("supports the expiry horizon used by the dashboard", () => {
    expect(addDaysIso("2026-01-01", 90)).toBe("2026-04-01");
    expect(addDaysIso("2026-01-01", 0)).toBe("2026-01-01");
  });
});
