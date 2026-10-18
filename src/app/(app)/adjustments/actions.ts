"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";

import { getDatabase } from "@/db/client";
import { requireUser } from "@/lib/authz";
import { DomainError } from "@/lib/errors";
import { adjustStock, previewAdjustment, type AdjustStockInput } from "@/lib/inventory-mutations";

export type AdjustActionResult =
  | { status: "ok"; newQtyRemaining: number }
  | { status: "approval-required" }
  | { status: "error"; message: string };

/**
 * Reason-coded stock adjustment (spec §3.3). Above the configured quantity or
 * value threshold, a second-user approval token is required — the client
 * replays the same input after the approval dialog grants one.
 */
export async function adjustStockAction(input: AdjustStockInput): Promise<AdjustActionResult> {
  const actor = await requireUser();
  try {
    const preview = await previewAdjustment(getDatabase(), actor, input);
    if (preview.needsStepUp && !input.approvalToken) {
      return { status: "approval-required" };
    }

    const result = await adjustStock(getDatabase(), actor, input);
    revalidatePath("/inventory");
    revalidatePath("/adjustments");
    return { status: "ok", newQtyRemaining: result.newQtyRemaining };
  } catch (error) {
    if (error instanceof DomainError) {
      if (error.code === "APPROVAL_REQUIRED" || error.code === "BAD_APPROVAL") {
        return { status: "approval-required" };
      }
      return { status: "error", message: error.message };
    }
    if (error instanceof ZodError) {
      return { status: "error", message: error.issues[0]?.message ?? "Invalid input." };
    }
    throw error;
  }
}
