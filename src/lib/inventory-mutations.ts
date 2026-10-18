import { z } from "zod";

import type { DatabaseHandle } from "@/db/client";
import type { JsonValue } from "@/db/schema/system";
import { consumeApproval } from "@/lib/approvals";
import { buildAuditStatement } from "@/lib/audit";
import type { SessionUser } from "@/lib/auth/session";
import { todayIso } from "@/lib/dates";
import { serverEnv } from "@/lib/env";
import { DomainError } from "@/lib/errors";
import { newId } from "@/lib/ids";
import {
  ADJUST_REASONS,
  adjustmentApprovalPayload,
  receivingApprovalPayload,
} from "@/lib/inventory-shared";
import { requireCapability } from "@/lib/permissions";
import {
  adjustmentNeedsStepUp,
  getAdjustmentStepUpThresholds,
  getMinShelfLifeDays,
} from "@/lib/settings";
import { checkExpiry } from "@/lib/shelf-life";
import { withWriteTx } from "@/lib/tx";
import { costPerBaseUnit, toBaseUnits } from "@/lib/units";

/**
 * Inventory mutations (spec §3.3, §6.3): ad-hoc receiving and reason-coded
 * stock adjustments. Both run inside a single `write` transaction with their
 * `stock_movements` rows, `controlled_register` rows and audit entries.
 *
 * Invariants enforced here (the CHECK constraints back them up):
 * - `qty_remaining` never goes below zero — updates are conditional and the
 *   affected-row count is checked (spec §4.3.4).
 * - Movement signs are directional: receipt > 0, writeoff < 0, adjust ±.
 * - Controlled products get a register row whose `balance_after` is the
 *   product's on-hand total at the branch after the movement.
 */

export const receiveLineSchema = z.object({
  productId: z.string().trim().min(1).max(40),
  unitId: z.string().trim().min(1).max(40),
  batchNo: z.string().trim().min(1).max(60),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expiry must be YYYY-MM-DD."),
  /** Quantity entered in the chosen selling unit. */
  qty: z.number().int().min(1).max(1_000_000),
  /** Cost per chosen selling unit in minor units. */
  unitCostMinor: z.number().int().min(0).max(1_000_000_000),
});
export type ReceiveLineInput = z.infer<typeof receiveLineSchema>;

export const receiveStockSchema = z.object({
  supplierId: z.string().trim().min(1).nullable().optional(),
  reference: z.string().trim().max(80).optional(),
  lines: z.array(receiveLineSchema).min(1).max(100),
  /** Manager approval token — required only when a line is inside min shelf-life. */
  approvalToken: z.string().trim().min(1).optional(),
});
export type ReceiveStockInput = z.infer<typeof receiveStockSchema>;

export interface ReceiveLineResult {
  productId: string;
  batchId: string;
  qtyBase: number;
  costPerBaseUnitMinor: number;
  toppedUp: boolean;
}

export interface ReceiveResult {
  receivingId: string;
  lines: ReceiveLineResult[];
}

export async function receiveStock(
  handle: DatabaseHandle,
  actor: SessionUser,
  rawInput: ReceiveStockInput,
): Promise<ReceiveResult> {
  requireCapability(actor, "inventory.receive");
  const input = receiveStockSchema.parse(rawInput);
  const branchId = requireBranch(actor);

  const tz = serverEnv().APP_TIMEZONE;
  const today = todayIso(tz);
  const minShelfLifeDays = await getMinShelfLifeDays(handle.db);
  const receivingId = newId();
  const now = Date.now();

  return withWriteTx(handle.client, async (tx) => {
    if (input.supplierId) {
      const supplier = await tx.execute({
        sql: "select id from suppliers where id = ? and active = 1",
        args: [input.supplierId],
      });
      if (supplier.rows.length === 0) {
        throw new DomainError("BAD_SUPPLIER", "Unknown or inactive supplier.");
      }
    }

    const results: ReceiveLineResult[] = [];
    const auditLines: JsonValue[] = [];
    let shelfLifeApprover: string | null = null;

    for (const line of input.lines) {
      const product = await tx.execute({
        sql: "select id, name, controlled_schedule from products where id = ? and active = 1",
        args: [line.productId],
      });
      if (product.rows.length === 0) {
        throw new DomainError(
          "BAD_PRODUCT",
          `Product ${line.productId} was not found or is inactive.`,
        );
      }
      const unit = await tx.execute({
        sql: "select id, name, factor_to_base from product_units where id = ? and product_id = ?",
        args: [line.unitId, line.productId],
      });
      if (unit.rows.length === 0) {
        throw new DomainError(
          "BAD_UNIT",
          `Unit does not belong to product ${String(product.rows[0].name)}.`,
        );
      }

      const factor = Number(unit.rows[0].factor_to_base);
      const qtyBase = toBaseUnits(line.qty, factor);
      const costBase = costPerBaseUnit(line.unitCostMinor, factor);

      const expiry = checkExpiry(line.expiryDate, today, minShelfLifeDays);
      if (!expiry.ok) {
        if (expiry.code === "TOO_SOON" && input.approvalToken) {
          // Manager-approved override: one token covers the whole receipt.
          shelfLifeApprover ??= (
            await consumeApproval(tx, {
              tokenId: input.approvalToken,
              requesterId: actor.id,
              action: "receiving.shelf_life",
              payload: receivingApprovalPayload(input),
              requireReason: true,
            })
          ).approverId;
        } else if (expiry.code === "TOO_SOON") {
          throw new DomainError(
            "APPROVAL_REQUIRED",
            `${String(product.rows[0].name)}: ${expiry.message} A manager can approve receiving it anyway.`,
          );
        } else {
          throw new DomainError("BAD_EXPIRY", `${String(product.rows[0].name)}: ${expiry.message}`);
        }
      }

      // Top-up path (spec §3.3 / schema note): same branch+product+batch+expiry
      // increases the existing row instead of inserting a duplicate.
      const existing = await tx.execute({
        sql: `select id, qty_remaining from batches
              where branch_id = ? and product_id = ? and batch_no = ? and expiry_date = ?`,
        args: [branchId, line.productId, line.batchNo, line.expiryDate],
      });

      let batchId: string;
      let toppedUp = false;
      if (existing.rows.length > 0) {
        batchId = String(existing.rows[0].id);
        toppedUp = true;
        await tx.execute({
          sql: `update batches
                set qty_received = qty_received + ?, qty_remaining = qty_remaining + ?,
                    supplier_id = coalesce(?, supplier_id), updated_at = ?
                where id = ?`,
          args: [qtyBase, qtyBase, input.supplierId ?? null, now, batchId],
        });
      } else {
        batchId = newId();
        await tx.execute({
          sql: `insert into batches
                (id, product_id, branch_id, batch_no, expiry_date, cost_per_base_unit,
                 qty_received, qty_remaining, supplier_id, received_at, created_at, updated_at)
                values (?,?,?,?,?,?,?,?,?,?,?,?)`,
          args: [
            batchId,
            line.productId,
            branchId,
            line.batchNo,
            line.expiryDate,
            costBase,
            qtyBase,
            qtyBase,
            input.supplierId ?? null,
            now,
            now,
            now,
          ],
        });
      }

      const movementId = newId();
      await tx.execute({
        sql: `insert into stock_movements
              (id, batch_id, type, qty_delta, ref_type, ref_id, reason, user_id, at, created_at)
              values (?,?,?,?,?,?,?,?,?,?)`,
        args: [
          movementId,
          batchId,
          "receipt",
          qtyBase,
          "receiving",
          receivingId,
          input.reference ? `Receiving ${input.reference}` : "Ad-hoc receiving",
          actor.id,
          now,
          now,
        ],
      });

      const controlled = product.rows[0].controlled_schedule;
      if (controlled !== null && controlled !== undefined) {
        await writeControlledRow(tx, {
          productId: line.productId,
          branchId,
          batchId,
          movementId,
          pharmacistId: actor.id,
          now,
        });
      }

      results.push({
        productId: line.productId,
        batchId,
        qtyBase,
        costPerBaseUnitMinor: costBase,
        toppedUp,
      });
      auditLines.push({
        productId: line.productId,
        batchId,
        batchNo: line.batchNo,
        expiryDate: line.expiryDate,
        qtyBase,
        toppedUp,
      });
    }

    await tx.execute(
      await buildAuditStatement({
        userId: actor.id,
        action: "stock.received",
        entity: "receiving",
        entityId: receivingId,
        after: {
          supplierId: input.supplierId ?? null,
          reference: input.reference ?? null,
          lines: auditLines,
          shelfLifeApprovedBy: shelfLifeApprover,
        },
      }),
    );

    return { receivingId, lines: results };
  });
}

// Reason codes live in `inventory-shared.ts` (client-safe); re-exported here
// so server callers keep a single import site.
export { ADJUST_REASONS } from "@/lib/inventory-shared";
export type { AdjustReason } from "@/lib/inventory-shared";

export const adjustStockSchema = z.object({
  batchId: z.string().trim().min(1).max(40),
  reason: z.enum(ADJUST_REASONS),
  /** Signed delta in base units; sign rules are enforced per reason below. */
  qtyDeltaBase: z.number().int().min(-1_000_000).max(1_000_000),
  notes: z.string().trim().max(200).optional(),
  /** Manager approval token — required when the adjustment crosses the step-up thresholds. */
  approvalToken: z.string().trim().min(1).optional(),
});
export type AdjustStockInput = z.infer<typeof adjustStockSchema>;

export interface AdjustPreview {
  batchId: string;
  productId: string;
  productName: string;
  batchNo: string;
  expiryDate: string;
  qtyRemaining: number;
  costPerBaseUnitMinor: number;
  controlled: boolean;
  needsStepUp: boolean;
}

/** Loads the batch + decides whether the step-up gate applies (advisory check for the action layer). */
export async function previewAdjustment(
  handle: DatabaseHandle,
  actor: SessionUser,
  input: AdjustStockInput,
): Promise<AdjustPreview> {
  requireCapability(actor, "inventory.adjust");
  const parsed = adjustStockSchema.parse(input);
  const branchId = requireBranch(actor);

  const rows = await handle.client.execute({
    sql: `select b.id, b.product_id, b.batch_no, b.expiry_date, b.qty_remaining,
                 b.cost_per_base_unit, p.name as product_name, p.controlled_schedule
          from batches b join products p on p.id = b.product_id
          where b.id = ? and b.branch_id = ?`,
    args: [parsed.batchId, branchId],
  });
  if (rows.rows.length === 0) {
    throw new DomainError("NOT_FOUND", "Batch not found for your branch.");
  }
  const row = rows.rows[0];
  const thresholds = await getAdjustmentStepUpThresholds(handle.db);
  const cost = Number(row.cost_per_base_unit);
  return {
    batchId: String(row.id),
    productId: String(row.product_id),
    productName: String(row.product_name),
    batchNo: String(row.batch_no),
    expiryDate: String(row.expiry_date),
    qtyRemaining: Number(row.qty_remaining),
    costPerBaseUnitMinor: cost,
    controlled: row.controlled_schedule !== null && row.controlled_schedule !== undefined,
    needsStepUp: adjustmentNeedsStepUp(parsed.qtyDeltaBase, cost, thresholds),
  };
}

export interface AdjustResult {
  adjustmentId: string;
  movementId: string;
  newQtyRemaining: number;
}

export async function adjustStock(
  handle: DatabaseHandle,
  actor: SessionUser,
  rawInput: AdjustStockInput,
): Promise<AdjustResult> {
  requireCapability(actor, "inventory.adjust");
  const input = adjustStockSchema.parse(rawInput);
  const branchId = requireBranch(actor);

  if (input.qtyDeltaBase === 0) {
    throw new DomainError("BAD_INPUT", "Adjustment quantity cannot be zero.");
  }
  // Sign rules: expiry_writeoff/damage/theft/sample remove stock; only
  // count_correction may go either direction.
  if (input.reason !== "count_correction" && input.qtyDeltaBase > 0) {
    throw new DomainError("BAD_SIGN", `A ${input.reason} adjustment must decrease stock.`);
  }
  if (input.reason === "expiry_writeoff" && input.qtyDeltaBase >= 0) {
    throw new DomainError("BAD_SIGN", "An expiry write-off must decrease stock.");
  }
  const movementType = input.reason === "expiry_writeoff" ? "writeoff" : "adjust";
  const thresholds = await getAdjustmentStepUpThresholds(handle.db);

  const adjustmentId = newId();
  const now = Date.now();

  return withWriteTx(handle.client, async (tx) => {
    const batch = await tx.execute({
      sql: `select b.id, b.product_id, b.qty_remaining, b.cost_per_base_unit, p.controlled_schedule
            from batches b join products p on p.id = b.product_id
            where b.id = ? and b.branch_id = ?`,
      args: [input.batchId, branchId],
    });
    if (batch.rows.length === 0) {
      throw new DomainError("NOT_FOUND", "Batch not found for your branch.");
    }
    const before = Number(batch.rows[0].qty_remaining);

    // Over-threshold adjustments need a second-user approval token (M2).
    let approverId: string | null = null;
    if (
      adjustmentNeedsStepUp(
        input.qtyDeltaBase,
        Number(batch.rows[0].cost_per_base_unit),
        thresholds,
      )
    ) {
      if (!input.approvalToken) {
        throw new DomainError(
          "APPROVAL_REQUIRED",
          "This adjustment is above the approval threshold — a manager must approve it.",
        );
      }
      approverId = (
        await consumeApproval(tx, {
          tokenId: input.approvalToken,
          requesterId: actor.id,
          action: "adjustment.threshold",
          payload: adjustmentApprovalPayload(input),
        })
      ).approverId;
    }

    // Conditional decrement (spec §4.3.4): the UPDATE itself enforces
    // qty_remaining >= 0, so a concurrent mover can never oversell — whoever
    // gets zero rows affected loses the race.
    const updated = await tx.execute({
      sql: `update batches set qty_remaining = qty_remaining + ?, updated_at = ?
            where id = ? and qty_remaining + ? >= 0`,
      args: [input.qtyDeltaBase, now, input.batchId, input.qtyDeltaBase],
    });
    if (updated.rowsAffected === 0) {
      throw new DomainError(
        "INSUFFICIENT_STOCK",
        `Only ${before} unit(s) remain on this batch — refresh and re-enter the adjustment.`,
      );
    }

    const movementId = newId();
    await tx.execute({
      sql: `insert into stock_movements
            (id, batch_id, type, qty_delta, ref_type, ref_id, reason, user_id, at, created_at)
            values (?,?,?,?,?,?,?,?,?,?)`,
      args: [
        movementId,
        input.batchId,
        movementType,
        input.qtyDeltaBase,
        "adjustment",
        adjustmentId,
        input.notes ? `${input.reason}: ${input.notes}` : input.reason,
        actor.id,
        now,
        now,
      ],
    });

    const controlled = batch.rows[0].controlled_schedule;
    if (controlled !== null && controlled !== undefined) {
      await writeControlledRow(tx, {
        productId: String(batch.rows[0].product_id),
        branchId,
        batchId: input.batchId,
        movementId,
        pharmacistId: actor.id,
        now,
      });
    }

    await tx.execute(
      await buildAuditStatement({
        userId: actor.id,
        action: "stock.adjusted",
        entity: "batches",
        entityId: input.batchId,
        before: { qtyRemaining: before },
        after: {
          qtyRemaining: before + input.qtyDeltaBase,
          reason: input.reason,
          movementType,
          approvedBy: approverId,
        },
      }),
    );

    return { adjustmentId, movementId, newQtyRemaining: before + input.qtyDeltaBase };
  });
}

async function writeControlledRow(
  tx: {
    execute: (stmt: {
      sql: string;
      args: (string | number | null)[];
    }) => Promise<{ rows: unknown[] }>;
  },
  params: {
    productId: string;
    branchId: string;
    batchId: string;
    movementId: string;
    pharmacistId: string;
    now: number;
  },
): Promise<void> {
  // balance_after = on-hand for the whole product at the branch (spec §14).
  const balance = await tx.execute({
    sql: `select coalesce(sum(qty_remaining), 0) as on_hand
          from batches where product_id = ? and branch_id = ?`,
    args: [params.productId, params.branchId],
  });
  await tx.execute({
    sql: `insert into controlled_register
          (id, product_id, batch_id, movement_id, balance_after, pharmacist_id, created_at)
          values (?,?,?,?,?,?,?)`,
    args: [
      newId(),
      params.productId,
      params.batchId,
      params.movementId,
      Number((balance.rows[0] as Record<string, unknown>).on_hand),
      params.pharmacistId,
      params.now,
    ],
  });
}

function requireBranch(actor: SessionUser): string {
  if (!actor.branchId) {
    throw new DomainError("NO_BRANCH", "Your account is not assigned to a branch.");
  }
  return actor.branchId;
}
