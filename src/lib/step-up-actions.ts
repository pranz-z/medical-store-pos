"use server";

import { requireUser } from "@/lib/authz";
import { verifyPin } from "@/lib/step-up";

/**
 * Shared PIN step-up action. Any signed-in user may verify *their own* PIN —
 * the granted cookie only unlocks actions the user's role could already take,
 * so this stays safe for every role. Returns the same result shape as the
 * feature actions so dialogs can share it.
 */
export async function verifyPinAction(input: {
  pin: string;
}): Promise<{ status: "ok" } | { status: "error"; message: string }> {
  const actor = await requireUser();
  const result = await verifyPin(actor, input.pin);
  return result.ok
    ? { status: "ok" }
    : { status: "error", message: result.error ?? "PIN verification failed." };
}
