import { headers } from "next/headers";

import { auth } from "@/lib/auth/auth";
import { isRole, type Role } from "@/lib/roles";

/**
 * The authenticated user as the app uses it. Deliberately a small, safe shape:
 * no password hashes, no PIN hash, no session tokens.
 */
export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  branchId: string | null;
}

/**
 * Reads the current session (DB-backed) and maps it to a `SessionUser`.
 * Returns null when there is no session, the user was deactivated, or the
 * stored role is unrecognized — callers redirect to /login in that case.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;

  const user = session.user as typeof session.user & {
    role?: unknown;
    branchId?: unknown;
    active?: unknown;
  };

  if (user.active === false || !isRole(user.role)) return null;

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    branchId: typeof user.branchId === "string" ? user.branchId : null,
  };
}
