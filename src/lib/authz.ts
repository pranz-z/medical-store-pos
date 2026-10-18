import { redirect } from "next/navigation";

import { getSessionUser, type SessionUser } from "@/lib/auth/session";
import type { Role } from "@/lib/roles";

/**
 * Authorization helpers (spec §9: role checks live server-side, close to the
 * data — never in the proxy only).
 *
 * Pages use `requireUser()` plus `hasRole()` to render a friendly
 * access-denied state; server actions use `requireRole()`, which throws so a
 * tampered request can never slip through.
 */

export class ForbiddenError extends Error {
  constructor(message = "You do not have permission to perform this action.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export function hasRole(user: SessionUser | null | undefined, ...roles: Role[]): boolean {
  return user != null && roles.includes(user.role);
}

/** Returns the signed-in user or redirects to /login. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

/** For server actions/route handlers: rejected requests throw instead of redirecting. */
export async function requireRole(...roles: Role[]): Promise<SessionUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) throw new ForbiddenError();
  return user;
}
