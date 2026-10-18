import { eq } from "drizzle-orm";

import type { Database } from "@/db/client";
import { rateLimits } from "@/db/schema/system";

/**
 * Rate limiting behind a swappable interface (spec §4.3 / M0 decision).
 *
 * The default implementation persists counters in the `rate_limits` table so
 * limits survive serverless cold starts and are shared by every instance. If
 * the app ever outgrows the database round-trip, swap in an Upstash/Redis
 * implementation of the same `RateLimiter` interface.
 *
 * Counting rules (approved design):
 *   - login: 10 failed attempts per email+IP per 15 min, then blocked 15 min
 *   - PIN step-up: 5 failed attempts per user per 15 min, then blocked 15 min
 */

export interface RateLimitRule {
  /** Failed attempts allowed inside the window. */
  limit: number;
  /** Length of the counting window. */
  windowMs: number;
  /** How long the key stays blocked once the limit is hit. */
  blockMs: number;
}

export const LOGIN_RATE_LIMIT: RateLimitRule = {
  limit: 10,
  windowMs: 15 * 60_000,
  blockMs: 15 * 60_000,
};

export const PIN_RATE_LIMIT: RateLimitRule = {
  limit: 5,
  windowMs: 15 * 60_000,
  blockMs: 15 * 60_000,
};

export interface RateLimitStatus {
  allowed: boolean;
  /** Attempts left before the block kicks in (0 while blocked). */
  remaining: number;
  /** Milliseconds until the key is allowed again (0 when allowed). */
  retryAfterMs: number;
}

export interface RateLimiter {
  /** Current status without recording an attempt. */
  check(key: string, rule: RateLimitRule): Promise<RateLimitStatus>;
  /** Records a failed attempt and returns the status for the next one. */
  registerFailure(key: string, rule: RateLimitRule): Promise<RateLimitStatus>;
  /** Clears the key after a success. */
  reset(key: string): Promise<void>;
}

export interface RateLimitRow {
  count: number;
  windowStartMs: number;
  blockedUntilMs: number | null;
}

/** Pure state transition: records a failure and returns the counters to store. */
export function applyFailure(
  row: RateLimitRow | undefined,
  rule: RateLimitRule,
  now: number,
): RateLimitRow {
  if (!row) {
    return { count: 1, windowStartMs: now, blockedUntilMs: null };
  }
  if (row.blockedUntilMs !== null && row.blockedUntilMs > now) {
    return row;
  }
  const windowExpired = now - row.windowStartMs >= rule.windowMs;
  if (windowExpired) {
    return { count: 1, windowStartMs: now, blockedUntilMs: null };
  }
  const count = row.count + 1;
  if (count >= rule.limit) {
    // Block for blockMs, then the window (reset to now) has also elapsed.
    return { count: 0, windowStartMs: now, blockedUntilMs: now + rule.blockMs };
  }
  return { count, windowStartMs: row.windowStartMs, blockedUntilMs: null };
}

/** Pure status evaluation for the current counters. */
export function evaluateStatus(
  row: RateLimitRow | undefined,
  rule: RateLimitRule,
  now: number,
): RateLimitStatus {
  if (!row) {
    return { allowed: true, remaining: rule.limit, retryAfterMs: 0 };
  }
  if (row.blockedUntilMs !== null && row.blockedUntilMs > now) {
    return { allowed: false, remaining: 0, retryAfterMs: row.blockedUntilMs - now };
  }
  const windowEnd = row.windowStartMs + rule.windowMs;
  if (now >= windowEnd) {
    return { allowed: true, remaining: rule.limit, retryAfterMs: 0 };
  }
  const remaining = Math.max(0, rule.limit - row.count);
  return remaining > 0
    ? { allowed: true, remaining, retryAfterMs: 0 }
    : { allowed: false, remaining: 0, retryAfterMs: windowEnd - now };
}

export class DbRateLimiter implements RateLimiter {
  constructor(private readonly db: Database) {}

  async check(key: string, rule: RateLimitRule): Promise<RateLimitStatus> {
    return evaluateStatus(await this.read(key), rule, Date.now());
  }

  async registerFailure(key: string, rule: RateLimitRule): Promise<RateLimitStatus> {
    const now = Date.now();
    const next = applyFailure(await this.read(key), rule, now);
    await this.write(key, next, now);
    return evaluateStatus(next, rule, now);
  }

  async reset(key: string): Promise<void> {
    await this.db.delete(rateLimits).where(eq(rateLimits.key, key));
  }

  private async read(key: string): Promise<RateLimitRow | undefined> {
    const rows = await this.db
      .select({
        count: rateLimits.count,
        windowStartMs: rateLimits.windowStartMs,
        blockedUntilMs: rateLimits.blockedUntilMs,
      })
      .from(rateLimits)
      .where(eq(rateLimits.key, key))
      .limit(1);
    return rows[0];
  }

  private async write(key: string, row: RateLimitRow, now: number): Promise<void> {
    await this.db
      .insert(rateLimits)
      .values({
        key,
        count: row.count,
        windowStartMs: row.windowStartMs,
        blockedUntilMs: row.blockedUntilMs,
        updatedAt: new Date(now),
      })
      .onConflictDoUpdate({
        target: rateLimits.key,
        set: {
          count: row.count,
          windowStartMs: row.windowStartMs,
          blockedUntilMs: row.blockedUntilMs,
          updatedAt: new Date(now),
        },
      });
  }
}

export function createRateLimiter(db: Database): RateLimiter {
  return new DbRateLimiter(db);
}
