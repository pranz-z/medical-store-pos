import type { DatabaseHandle } from "@/db/client";
import type { SessionUser } from "@/lib/auth/session";
import { DomainError } from "@/lib/errors";
import { can, requireCapability } from "@/lib/permissions";

/** Shift list + report reads (spec §6.1.9). */

export interface ShiftRow {
  id: string;
  userId: string;
  userName: string;
  openedAt: number;
  closedAt: number | null;
  openingFloatMinor: number;
  expectedCashMinor: number | null;
  countedCashMinor: number | null;
  varianceMinor: number | null;
}

/**
 * Lists shifts for the actor's branch. Cashiers see only their own shifts;
 * `shift.all` roles (owner/manager) see everyone's.
 */
export async function listShifts(handle: DatabaseHandle, actor: SessionUser): Promise<ShiftRow[]> {
  requireCapability(actor, "sales.view");
  if (!actor.branchId)
    throw new DomainError("NO_BRANCH", "Your account is not assigned to a branch.");
  const seeAll = can(actor.role, "shifts.view_all");
  const rs = await handle.client.execute({
    sql: `select s.id, s.user_id, coalesce(u.name, u.email) as user_name,
                 s.opened_at, s.closed_at, s.opening_float,
                 s.expected_cash, s.counted_cash, s.variance
          from shifts s join users u on u.id = s.user_id
          where s.branch_id = ? ${seeAll ? "" : "and s.user_id = ?"}
          order by s.opened_at desc limit 200`,
    args: seeAll ? [actor.branchId] : [actor.branchId, actor.id],
  });
  return rs.rows.map((row) => ({
    id: String(row.id),
    userId: String(row.user_id),
    userName: String(row.user_name),
    openedAt: Number(row.opened_at),
    closedAt: row.closed_at === null ? null : Number(row.closed_at),
    openingFloatMinor: Number(row.opening_float),
    expectedCashMinor: row.expected_cash === null ? null : Number(row.expected_cash),
    countedCashMinor: row.counted_cash === null ? null : Number(row.counted_cash),
    varianceMinor: row.variance === null ? null : Number(row.variance),
  }));
}

export interface ShiftReport {
  shift: ShiftRow;
  salesCount: number;
  salesTotalMinor: number;
  discountsMinor: number;
  taxMinor: number;
  byMethod: { method: string; amountMinor: number; changeMinor: number }[];
}

/** Full report for one shift: sales count, tender totals, discounts, variance. */
export async function getShiftReport(
  handle: DatabaseHandle,
  actor: SessionUser,
  shiftId: string,
): Promise<ShiftReport> {
  requireCapability(actor, "sales.view");
  if (!actor.branchId)
    throw new DomainError("NO_BRANCH", "Your account is not assigned to a branch.");
  const shifts = await listShifts(handle, actor);
  const shift = shifts.find((s) => s.id === shiftId);
  if (!shift) throw new DomainError("NOT_FOUND", "Shift not found.");

  const totals = await handle.client.execute({
    sql: `select count(*) as n,
                 coalesce(sum(total), 0) as total,
                 coalesce(sum(discount_total), 0) as discounts,
                 coalesce(sum(tax_total), 0) as tax
          from sales where shift_id = ? and status = 'completed'`,
    args: [shiftId],
  });
  const byMethod = await handle.client.execute({
    sql: `select p.method as method,
                 coalesce(sum(p.amount), 0) as amount,
                 coalesce(sum(p.change_given), 0) as change
          from payments p join sales s on s.id = p.sale_id
          where s.shift_id = ? and s.status = 'completed'
          group by p.method order by p.method`,
    args: [shiftId],
  });

  return {
    shift,
    salesCount: Number(totals.rows[0].n),
    salesTotalMinor: Number(totals.rows[0].total),
    discountsMinor: Number(totals.rows[0].discounts),
    taxMinor: Number(totals.rows[0].tax),
    byMethod: byMethod.rows.map((row) => ({
      method: String(row.method),
      amountMinor: Number(row.amount),
      changeMinor: Number(row.change),
    })),
  };
}
