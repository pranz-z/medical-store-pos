import { createHmac, timingSafeEqual } from "node:crypto";

import { verifyPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";

import { getDb } from "@/db/client";
import { users } from "@/db/schema/auth";
import type { SessionUser } from "@/lib/auth/session";
import { serverEnv } from "@/lib/env";
import { PIN_RATE_LIMIT, createRateLimiter } from "@/lib/rate-limit";

/**
 * PIN step-up (spec §5.1 `users.pin_hash`, FR-* privileged actions).
 *
 * Sensitive actions (role changes, deactivations, later: voids, refunds,
 * price overrides) ask the user to re-enter their 4–6 digit PIN. A successful
 * verification sets a short-lived, HMAC-signed, http-only cookie — no session
 * table changes. Wrong PINs are rate-limited per user (5 per 15 min, then a
 * 15 min block) using the same `rate_limits` table as login.
 *
 * The PIN hash uses the same scrypt hasher as login passwords, so there is no
 * second crypto dependency to audit.
 */

export const STEP_UP_COOKIE = "ms-step-up";
export const STEP_UP_TTL_MS = 10 * 60_000;

export interface PinVerification {
  ok: boolean;
  error?: string;
}

export async function verifyPin(user: SessionUser, pin: string): Promise<PinVerification> {
  if (!/^\d{4,6}$/.test(pin)) {
    return { ok: false, error: "PIN must be 4–6 digits." };
  }

  const limiter = createRateLimiter(getDb());
  const key = `pin:${user.id}`;

  const status = await limiter.check(key, PIN_RATE_LIMIT);
  if (!status.allowed) {
    return { ok: false, error: retryMessage(status.retryAfterMs) };
  }

  const rows = await getDb()
    .select({ pinHash: users.pinHash })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);
  const hash = rows[0]?.pinHash;

  if (!hash) {
    return { ok: false, error: "This account has no PIN set." };
  }

  const valid = await verifyPassword({ hash, password: pin });
  if (!valid) {
    const after = await limiter.registerFailure(key, PIN_RATE_LIMIT);
    return {
      ok: false,
      error: after.allowed ? "Incorrect PIN." : retryMessage(after.retryAfterMs),
    };
  }

  await limiter.reset(key);
  await grantStepUp(user.id);
  return { ok: true };
}

/** True while the step-up cookie is valid for this user. */
export async function hasStepUp(userId: string): Promise<boolean> {
  const store = await cookies();
  const raw = store.get(STEP_UP_COOKIE)?.value;
  if (!raw) return false;

  const [id, expiresAtRaw, signature] = raw.split(".");
  if (!id || !expiresAtRaw || !signature) return false;
  if (id !== userId) return false;

  if (!safeEqual(signature, sign(`${id}.${expiresAtRaw}`))) return false;

  const expiresAt = Number(expiresAtRaw);
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

export async function clearStepUp(): Promise<void> {
  const store = await cookies();
  store.delete(STEP_UP_COOKIE);
}

async function grantStepUp(userId: string): Promise<void> {
  const payload = `${userId}.${Date.now() + STEP_UP_TTL_MS}`;
  const store = await cookies();
  store.set(STEP_UP_COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(STEP_UP_TTL_MS / 1000),
  });
}

function sign(payload: string): string {
  return createHmac("sha256", serverEnv().AUTH_SECRET).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function retryMessage(retryAfterMs: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterMs / 60_000));
  return `Too many incorrect PINs. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}
