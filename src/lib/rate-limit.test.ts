import { describe, expect, it } from "vitest";

import {
  LOGIN_RATE_LIMIT,
  PIN_RATE_LIMIT,
  applyFailure,
  evaluateStatus,
  type RateLimitRow,
} from "@/lib/rate-limit";

/**
 * Pure rate-limit state transitions. These are the rules the login and PIN
 * flows rely on; the DB wrapper (DbRateLimiter) is exercised only through them.
 */

const T0 = 1_700_000_000_000;

describe("rate limit rules", () => {
  it("matches the approved limits (login 10/15min, PIN 5/15min, 15min blocks)", () => {
    expect(LOGIN_RATE_LIMIT).toEqual({ limit: 10, windowMs: 900_000, blockMs: 900_000 });
    expect(PIN_RATE_LIMIT).toEqual({ limit: 5, windowMs: 900_000, blockMs: 900_000 });
  });
});

describe("applyFailure", () => {
  it("starts a fresh window on the first failure", () => {
    expect(applyFailure(undefined, PIN_RATE_LIMIT, T0)).toEqual({
      count: 1,
      windowStartMs: T0,
      blockedUntilMs: null,
    });
  });

  it("increments inside the window", () => {
    const next = applyFailure(
      { count: 2, windowStartMs: T0, blockedUntilMs: null },
      PIN_RATE_LIMIT,
      T0 + 60_000,
    );
    expect(next).toEqual({ count: 3, windowStartMs: T0, blockedUntilMs: null });
  });

  it("blocks for blockMs once the limit is reached", () => {
    const next = applyFailure(
      { count: PIN_RATE_LIMIT.limit - 1, windowStartMs: T0, blockedUntilMs: null },
      PIN_RATE_LIMIT,
      T0 + 1_000,
    );
    expect(next).toEqual({
      count: 0,
      windowStartMs: T0 + 1_000,
      blockedUntilMs: T0 + 1_000 + PIN_RATE_LIMIT.blockMs,
    });
  });

  it("keeps the existing block while it is active", () => {
    const blocked: RateLimitRow = { count: 0, windowStartMs: T0, blockedUntilMs: T0 + 900_000 };
    expect(applyFailure(blocked, PIN_RATE_LIMIT, T0 + 1)).toEqual(blocked);
    expect(applyFailure(blocked, PIN_RATE_LIMIT, T0 + 899_999)).toEqual(blocked);
  });

  it("resets to one after the block expires", () => {
    const blocked: RateLimitRow = { count: 0, windowStartMs: T0, blockedUntilMs: T0 + 900_000 };
    expect(applyFailure(blocked, PIN_RATE_LIMIT, T0 + 900_001)).toEqual({
      count: 1,
      windowStartMs: T0 + 900_001,
      blockedUntilMs: null,
    });
  });

  it("resets when the counting window has elapsed", () => {
    const next = applyFailure(
      { count: 4, windowStartMs: T0, blockedUntilMs: null },
      PIN_RATE_LIMIT,
      T0 + PIN_RATE_LIMIT.windowMs,
    );
    expect(next).toEqual({
      count: 1,
      windowStartMs: T0 + PIN_RATE_LIMIT.windowMs,
      blockedUntilMs: null,
    });
  });

  it("never exposes more attempts than the limit allows", () => {
    let row: RateLimitRow | undefined;
    for (let attempt = 1; attempt < PIN_RATE_LIMIT.limit; attempt += 1) {
      row = applyFailure(row, PIN_RATE_LIMIT, T0);
      expect(row.blockedUntilMs).toBeNull();
    }
    row = applyFailure(row, PIN_RATE_LIMIT, T0);
    expect(row.blockedUntilMs).toBe(T0 + PIN_RATE_LIMIT.blockMs);
  });
});

describe("evaluateStatus", () => {
  it("allows everything when no row exists", () => {
    expect(evaluateStatus(undefined, PIN_RATE_LIMIT, T0)).toEqual({
      allowed: true,
      remaining: PIN_RATE_LIMIT.limit,
      retryAfterMs: 0,
    });
  });

  it("reports remaining attempts inside the window", () => {
    expect(
      evaluateStatus({ count: 3, windowStartMs: T0, blockedUntilMs: null }, PIN_RATE_LIMIT, T0 + 1),
    ).toEqual({
      allowed: true,
      remaining: 2,
      retryAfterMs: 0,
    });
  });

  it("blocks with retryAfterMs while a block is active", () => {
    const status = evaluateStatus(
      { count: 0, windowStartMs: T0, blockedUntilMs: T0 + 900_000 },
      PIN_RATE_LIMIT,
      T0 + 300_000,
    );
    expect(status).toEqual({ allowed: false, remaining: 0, retryAfterMs: 600_000 });
  });

  it("defensively blocks when the count reached the limit without a block", () => {
    const status = evaluateStatus(
      { count: PIN_RATE_LIMIT.limit, windowStartMs: T0, blockedUntilMs: null },
      PIN_RATE_LIMIT,
      T0 + 1_000,
    );
    expect(status).toEqual({
      allowed: false,
      remaining: 0,
      retryAfterMs: PIN_RATE_LIMIT.windowMs - 1_000,
    });
  });

  it("allows again once the window has elapsed", () => {
    expect(
      evaluateStatus(
        { count: 9, windowStartMs: T0, blockedUntilMs: null },
        LOGIN_RATE_LIMIT,
        T0 + LOGIN_RATE_LIMIT.windowMs,
      ),
    ).toEqual({ allowed: true, remaining: LOGIN_RATE_LIMIT.limit, retryAfterMs: 0 });
  });
});
