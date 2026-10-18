import { describe, expect, it } from "vitest";

import { allocateFefo, type FefoCandidate } from "@/lib/fefo";

const TODAY = "2026-02-10";

const batch = (batchId: string, expiryDate: string, qtyRemaining: number): FefoCandidate => ({
  batchId,
  expiryDate,
  qtyRemaining,
});

describe("allocateFefo", () => {
  it("draws from the earliest-expiry batch first", () => {
    const allocations = allocateFefo(
      [batch("b-late", "2027-01-01", 50), batch("b-early", "2026-06-01", 50)],
      30,
      TODAY,
    );
    expect(allocations).toEqual([{ batchId: "b-early", expiryDate: "2026-06-01", qtyBase: 30 }]);
  });

  it("splits across batches when the earliest cannot cover the request", () => {
    const allocations = allocateFefo(
      [
        batch("b1", "2026-06-01", 10),
        batch("b2", "2026-09-01", 40),
        batch("b3", "2027-01-01", 100),
      ],
      45,
      TODAY,
    );
    expect(allocations).toEqual([
      { batchId: "b1", expiryDate: "2026-06-01", qtyBase: 10 },
      { batchId: "b2", expiryDate: "2026-09-01", qtyBase: 35 },
    ]);
  });

  it("skips expired batches even when they still hold stock", () => {
    const allocations = allocateFefo(
      [batch("b-expired", "2026-01-01", 100), batch("b-good", "2026-06-01", 10)],
      10,
      TODAY,
    );
    expect(allocations).toEqual([{ batchId: "b-good", expiryDate: "2026-06-01", qtyBase: 10 }]);
  });

  it("treats a batch expiring today as sellable (boundary)", () => {
    const allocations = allocateFefo([batch("b-today", TODAY, 5)], 5, TODAY);
    expect(allocations).toEqual([{ batchId: "b-today", expiryDate: TODAY, qtyBase: 5 }]);
  });

  it("returns null when usable stock cannot cover the request", () => {
    expect(
      allocateFefo([batch("b1", "2026-06-01", 4), batch("b2", "2026-09-01", 4)], 9, TODAY),
    ).toBeNull();
  });

  it("returns null when every batch is expired", () => {
    expect(allocateFefo([batch("b1", "2026-01-01", 100)], 1, TODAY)).toBeNull();
  });

  it("ignores zero-quantity batches and unsorted input order", () => {
    const allocations = allocateFefo(
      [
        batch("b-zero", "2026-03-01", 0),
        batch("b2", "2026-09-01", 5),
        batch("b1", "2026-06-01", 5),
      ],
      8,
      TODAY,
    );
    expect(allocations).toEqual([
      { batchId: "b1", expiryDate: "2026-06-01", qtyBase: 5 },
      { batchId: "b2", expiryDate: "2026-09-01", qtyBase: 3 },
    ]);
  });

  it("rejects non-positive or non-integer quantities", () => {
    expect(() => allocateFefo([], 0, TODAY)).toThrow();
    expect(() => allocateFefo([], -3, TODAY)).toThrow();
    expect(() => allocateFefo([], 1.5, TODAY)).toThrow();
  });
});
