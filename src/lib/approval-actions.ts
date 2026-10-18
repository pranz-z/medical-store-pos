"use server";

import { z } from "zod";

import { getDatabase } from "@/db/client";
import { requireUser } from "@/lib/authz";
import { DomainError } from "@/lib/errors";
import { grantApproval, type ApprovalAction } from "@/lib/approvals";

const ACTIONS: ApprovalAction[] = [
  "adjustment.threshold",
  "receiving.shelf_life",
  "sale.discount_over_limit",
];

const requestSchema = z.object({
  approverEmail: z.string().trim().min(3).max(120),
  pin: z.string().regex(/^\d{4,6}$/),
  action: z.enum(ACTIONS as [ApprovalAction, ...ApprovalAction[]]),
  /** The exact domain payload to approve; hashed server-side and bound to the token. */
  payload: z.unknown(),
  reason: z.string().trim().max(200).optional(),
});

export type ApprovalRequestResult =
  { status: "ok"; token: string } | { status: "error"; message: string };

/**
 * Grants a second-user approval token. Called from the shared approval dialog;
 * the caller then replays its original action with `approvalToken` set.
 */
export async function requestApprovalAction(input: unknown): Promise<ApprovalRequestResult> {
  const requester = await requireUser();
  try {
    const parsed = requestSchema.parse(input);
    const { token } = await grantApproval(getDatabase(), {
      approverEmail: parsed.approverEmail,
      pin: parsed.pin,
      requester,
      action: parsed.action,
      payload: parsed.payload,
      ...(parsed.reason !== undefined ? { reason: parsed.reason } : {}),
    });
    return { status: "ok", token };
  } catch (error) {
    if (error instanceof DomainError) return { status: "error", message: error.message };
    if (error instanceof z.ZodError) {
      return { status: "error", message: error.issues[0]?.message ?? "Invalid input." };
    }
    throw error;
  }
}
