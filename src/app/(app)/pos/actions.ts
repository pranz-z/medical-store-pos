"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";

import { getDatabase } from "@/db/client";
import { requireUser } from "@/lib/authz";
import { DomainError } from "@/lib/errors";
import { ForbiddenError } from "@/lib/authz";
import type { SaleReceipt } from "@/lib/pos-shared";
import { reprintSale } from "@/lib/sales-mutations";
import { closeShift, openShift } from "@/lib/shift-mutations";

export type ActionResult = { status: "ok" } | { status: "error"; message: string };

function toMessage(error: unknown): string {
  if (error instanceof DomainError || error instanceof ForbiddenError) return error.message;
  if (error instanceof ZodError) return error.issues[0]?.message ?? "Invalid input.";
  throw error;
}

export async function openShiftAction(
  openingFloatMinor: number,
): Promise<
  | { status: "error"; message: string }
  | { status: "ok"; shift: { id: string; openingFloatMinor: number; openedAt: number } }
> {
  const actor = await requireUser();
  try {
    const result = await openShift(getDatabase(), actor, { openingFloatMinor });
    revalidatePath("/pos");
    revalidatePath("/shifts");
    return {
      status: "ok",
      shift: { id: result.shiftId, openingFloatMinor, openedAt: Date.now() },
    };
  } catch (error) {
    return { status: "error", message: toMessage(error) };
  }
}

export async function closeShiftAction(
  shiftId: string,
  countedCashMinor: number,
): Promise<ActionResult | { status: "ok"; expectedMinor: number; varianceMinor: number }> {
  const actor = await requireUser();
  try {
    const result = await closeShift(getDatabase(), actor, { shiftId, countedCashMinor });
    revalidatePath("/pos");
    revalidatePath("/shifts");
    return {
      status: "ok",
      expectedMinor: result.expectedCashMinor,
      varianceMinor: result.varianceMinor,
    };
  } catch (error) {
    return { status: "error", message: toMessage(error) };
  }
}

/** Reprint marks the audit trail and returns the receipt for printing. */
export async function reprintSaleAction(saleId: string): Promise<SaleReceipt | { error: string }> {
  const actor = await requireUser();
  try {
    return await reprintSale(getDatabase(), actor, saleId);
  } catch (error) {
    return { error: toMessage(error) };
  }
}
