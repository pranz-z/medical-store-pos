import { z } from "zod";

import type { DatabaseHandle } from "@/db/client";
import { buildAuditStatement } from "@/lib/audit";
import type { SessionUser } from "@/lib/auth/session";
import { DomainError } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { requireCapability } from "@/lib/permissions";
import { withWriteTx } from "@/lib/tx";

/**
 * Shift lifecycle (spec §6.1.9): open with an opening float, close with
 * counted cash. expected_cash = opening float + cash received − change given
 * (refunds arrive in M3). One open shift per user per branch.
 */

export const openShiftSchema = z.object({
  openingFloatMinor: z.number().int().min(0).max(10_000_000),
});
export type OpenShiftInput = z.infer<typeof openShiftSchema>;

export const closeShiftSchema = z.object({
  shiftId: z.string().trim().min(1).max(40),
  countedCashMinor: z.number().int().min(0).max(100_000_000),
  notes: z.string().trim().max(200).optional(),
});
export type CloseShiftInput = z.infer<typeof closeShiftSchema>;

export async function openShift(
  handle: DatabaseHandle,
  actor: SessionUser,
  input: OpenShiftInput,
): Promise<{ shiftId: string }> {
  requireCapability(actor, "pos.sell");
  const branchId = requireBranch(actor);
  const parsed = openShiftSchema.parse(input);
  const shiftId = newId();
  const now = Date.now();

  return withWriteTx(handle.client, async (tx) => {
    const open = await tx.execute({
      sql: `select id from shifts where user_id = ? and branch_id = ? and closed_at is null`,
      args: [actor.id, branchId],
    });
    if (open.rows.length > 0) {
      throw new DomainError("SHIFT_OPEN", "You already have an open shift at this branch.");
    }

    await tx.execute({
      sql: `insert into shifts (id, user_id, branch_id, opened_at, opening_float, created_at, updated_at)
            values (?,?,?,?,?,?,?)`,
      args: [shiftId, actor.id, branchId, now, parsed.openingFloatMinor, now, now],
    });
    await tx.execute(
      await buildAuditStatement({
        userId: actor.id,
        action: "shift.opened",
        entity: "shifts",
        entityId: shiftId,
        after: { openingFloatMinor: parsed.openingFloatMinor },
      }),
    );
    return { shiftId };
  });
}

export async function closeShift(
  handle: DatabaseHandle,
  actor: SessionUser,
  input: CloseShiftInput,
): Promise<{ expectedCashMinor: number; varianceMinor: number }> {
  requireCapability(actor, "pos.sell");
  const branchId = requireBranch(actor);
  const parsed = closeShiftSchema.parse(input);
  const now = Date.now();

  return withWriteTx(handle.client, async (tx) => {
    const shift = await tx.execute({
      sql: `select id, user_id, opening_float, closed_at
            from shifts where id = ? and branch_id = ?`,
      args: [parsed.shiftId, branchId],
    });
    if (shift.rows.length === 0) throw new DomainError("NOT_FOUND", "Shift not found.");
    const row = shift.rows[0];
    if (row.closed_at !== null)
      throw new DomainError("SHIFT_CLOSED", "This shift is already closed.");
    // Users close their own shift; a manager/owner may close someone else's.
    if (row.user_id !== actor.id && actor.role !== "owner" && actor.role !== "manager") {
      throw new DomainError("FORBIDDEN", "Only the shift owner or a manager can close this shift.");
    }

    const cash = await tx.execute({
      sql: `select coalesce(sum(p.amount), 0) as received,
                   coalesce(sum(p.change_given), 0) as change
            from payments p join sales s on s.id = p.sale_id
            where s.shift_id = ? and p.method = 'cash' and s.status = 'completed'`,
      args: [parsed.shiftId],
    });
    const openingFloat = Number(row.opening_float);
    const expected = openingFloat + Number(cash.rows[0].received) - Number(cash.rows[0].change);
    const variance = parsed.countedCashMinor - expected;

    const closed = await tx.execute({
      sql: `update shifts set closed_at = ?, expected_cash = ?, counted_cash = ?, variance = ?, updated_at = ?
            where id = ? and closed_at is null`,
      args: [now, expected, parsed.countedCashMinor, variance, now, parsed.shiftId],
    });
    if (closed.rowsAffected === 0) {
      throw new DomainError("SHIFT_CLOSED", "This shift is already closed.");
    }

    await tx.execute(
      await buildAuditStatement({
        userId: actor.id,
        action: "shift.closed",
        entity: "shifts",
        entityId: parsed.shiftId,
        after: {
          expectedCashMinor: expected,
          countedCashMinor: parsed.countedCashMinor,
          varianceMinor: variance,
          notes: parsed.notes ?? null,
        },
      }),
    );
    return { expectedCashMinor: expected, varianceMinor: variance };
  });
}

/** The current user's open shift at their branch, or null. Used by the POS gate. */
export async function getOpenShift(
  handle: DatabaseHandle,
  actor: SessionUser,
): Promise<{ id: string; openingFloatMinor: number; openedAt: number } | null> {
  if (!actor.branchId) return null;
  const rs = await handle.client.execute({
    sql: `select id, opening_float, opened_at from shifts
          where user_id = ? and branch_id = ? and closed_at is null`,
    args: [actor.id, actor.branchId],
  });
  if (rs.rows.length === 0) return null;
  return {
    id: String(rs.rows[0].id),
    openingFloatMinor: Number(rs.rows[0].opening_float),
    openedAt: Number(rs.rows[0].opened_at),
  };
}

function requireBranch(actor: SessionUser): string {
  if (!actor.branchId) {
    throw new DomainError("NO_BRANCH", "Your account is not assigned to a branch.");
  }
  return actor.branchId;
}
