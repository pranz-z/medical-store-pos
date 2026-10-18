"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getDb } from "@/db/client";
import { auth } from "@/lib/auth/auth";
import { logger } from "@/lib/logger";
import { LOGIN_RATE_LIMIT, createRateLimiter } from "@/lib/rate-limit";
import { requestContext } from "@/lib/request-context";

/**
 * Sign-in/sign-out server actions.
 *
 * The public Better Auth `/sign-in/email` endpoint is disabled (see
 * `src/lib/auth/auth.ts`), so this action is the only way in: it can rate-limit
 * failed attempts on the `rate_limits` table and it never reveals whether the
 * email exists. The `nextCookies()` plugin writes the session cookie when
 * `auth.api.signInEmail` is called inside a server action.
 */

export interface SignInState {
  error?: string;
}

export async function signInAction(
  _previous: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Enter your email and password." };
  }

  const context = await requestContext();
  const limiter = createRateLimiter(getDb());
  const key = `login:${email}:${context.ip ?? "unknown-ip"}`;

  const status = await limiter.check(key, LOGIN_RATE_LIMIT);
  if (!status.allowed) {
    return { error: retryMessage(status.retryAfterMs) };
  }

  try {
    await auth.api.signInEmail({
      body: { email, password },
      headers: await headers(),
    });
  } catch {
    const after = await limiter.registerFailure(key, LOGIN_RATE_LIMIT);
    // Never log the email (PII, spec §9) — the email is already part of the
    // rate-limit key inside the database.
    logger.warn("sign-in rejected", {
      requestId: context.requestId,
      ip: context.ip,
      remaining: after.remaining,
    });
    return { error: "Invalid email or password." };
  }

  await limiter.reset(key);
  logger.info("sign-in accepted", { requestId: context.requestId, ip: context.ip });
  redirect("/");
}

export async function signOutAction(): Promise<void> {
  try {
    await auth.api.signOut({ headers: await headers() });
  } catch {
    // An already-invalid session is fine to ignore — the redirect still runs.
  }
  redirect("/login");
}

function retryMessage(retryAfterMs: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterMs / 60_000));
  return `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}
