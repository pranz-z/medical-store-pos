"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";

import { getDatabase } from "@/db/client";
import { requireUser } from "@/lib/authz";
import { DomainError } from "@/lib/errors";
import { receiveStock, type ReceiveStockInput } from "@/lib/inventory-mutations";

export type ReceiveActionResult =
  { status: "ok"; receivingId: string; lines: number } | { status: "error"; message: string };

/**
 * Ad-hoc receiving (spec §6.3). `receiveStock` re-validates the payload and
 * runs the batch top-up + movement + controlled register + audit writes in a
 * single transaction.
 */
export async function receiveStockAction(input: ReceiveStockInput): Promise<ReceiveActionResult> {
  const actor = await requireUser();
  try {
    const result = await receiveStock(getDatabase(), actor, input);
    revalidatePath("/inventory");
    revalidatePath("/receiving");
    return { status: "ok", receivingId: result.receivingId, lines: result.lines.length };
  } catch (error) {
    if (error instanceof DomainError) return { status: "error", message: error.message };
    if (error instanceof ZodError) {
      return { status: "error", message: error.issues[0]?.message ?? "Invalid input." };
    }
    throw error;
  }
}
