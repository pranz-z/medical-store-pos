"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { getDb } from "@/db/client";
import { sessions, users } from "@/db/schema/auth";
import { recordAudit } from "@/lib/audit";
import { requireRole } from "@/lib/authz";
import { isRole } from "@/lib/roles";
import { hasStepUp, verifyPin } from "@/lib/step-up";

/**
 * Owner-only user management actions (spec §5.1 `users`, §9 role gating).
 *
 * Every privileged mutation follows the same pattern:
 *   1. `requireRole("owner")` — throws unless the caller is an active owner.
 *   2. `hasStepUp` — if the PIN step-up window has expired, return
 *      `{ status: "step-up-required" }` so the UI can ask for the PIN and
 *      retry the exact same action.
 *   3. mutate → record an audit row → revalidate the page.
 *
 * Self-service footguns are blocked: no changing your own role and no
 * deactivating your own account.
 */

export type UserActionResult =
  { status: "ok" } | { status: "step-up-required" } | { status: "error"; message: string };

export async function updateUserRoleAction(input: {
  userId: string;
  role: string;
}): Promise<UserActionResult> {
  const actor = await requireRole("owner");
  if (input.userId === actor.id) {
    return { status: "error", message: "You cannot change your own role." };
  }
  if (!isRole(input.role)) {
    return { status: "error", message: "Unknown role." };
  }

  const db = getDb();
  const rows = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);
  const target = rows[0];
  if (!target) {
    return { status: "error", message: "User not found." };
  }
  if (target.role === input.role) {
    return { status: "ok" };
  }

  if (!(await hasStepUp(actor.id))) return { status: "step-up-required" };

  await db.update(users).set({ role: input.role }).where(eq(users.id, input.userId));
  await recordAudit({
    userId: actor.id,
    action: "user.role_changed",
    entity: "users",
    entityId: input.userId,
    before: { role: target.role },
    after: { role: input.role },
  });

  revalidatePath("/users");
  return { status: "ok" };
}

export async function setUserActiveAction(input: {
  userId: string;
  active: boolean;
}): Promise<UserActionResult> {
  const actor = await requireRole("owner");
  if (input.userId === actor.id) {
    return { status: "error", message: "You cannot deactivate your own account." };
  }

  const db = getDb();
  const rows = await db
    .select({ active: users.active })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);
  const target = rows[0];
  if (!target) {
    return { status: "error", message: "User not found." };
  }
  if (target.active === input.active) {
    return { status: "ok" };
  }

  if (!(await hasStepUp(actor.id))) return { status: "step-up-required" };

  await db.update(users).set({ active: input.active }).where(eq(users.id, input.userId));
  if (!input.active) {
    // Deactivation takes effect immediately: kill the user's live sessions.
    await db.delete(sessions).where(eq(sessions.userId, input.userId));
  }
  await recordAudit({
    userId: actor.id,
    action: input.active ? "user.activated" : "user.deactivated",
    entity: "users",
    entityId: input.userId,
    before: { active: target.active },
    after: { active: input.active },
  });

  revalidatePath("/users");
  return { status: "ok" };
}

export async function verifyPinAction(input: { pin: string }): Promise<UserActionResult> {
  const actor = await requireRole("owner");
  const result = await verifyPin(actor, input.pin);
  return result.ok
    ? { status: "ok" }
    : { status: "error", message: result.error ?? "PIN verification failed." };
}
