import { z } from "zod";

import type { Transaction } from "@libsql/client";

import type { DatabaseHandle } from "@/db/client";
import { consumeApproval } from "@/lib/approvals";
import { buildAuditStatement, recordAudit } from "@/lib/audit";
import type { SessionUser } from "@/lib/auth/session";
import { todayIso } from "@/lib/dates";
import { serverEnv } from "@/lib/env";
import { DomainError } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { requireCapability } from "@/lib/permissions";
import {
  PAYMENT_METHODS,
  discountApprovalPayload,
  type CheckoutInput,
  type PaymentMethod,
  type ReceiptLine,
  type ReceiptPayment,
  type SaleReceipt,
  type StockAvailability,
} from "@/lib/pos-shared";
import { getReceipt } from "@/lib/sales-queries";
import { applyCashRounding, getCashRounding, getDiscountMaxPct } from "@/lib/settings";
import { withWriteTx } from "@/lib/tx";

/**
 * Checkout (spec §6.1): FEFO sale, re-priced on the server, in one write
 * transaction. Client prices and totals are never sent or trusted — the input
 * schema simply does not carry them, so any tampered fields are stripped.
 *
 * Integer-only money rules (documented per spec §6.1.3):
 * - Whole-unit lines: lineGross = unitPrice × (qtyBase ÷ factor) — exact.
 * - Loose lines (sellable_loose): pricePerBase = unitPrice ÷ factor rounded
 *   half-up to the nearest minor unit; lineGross = pricePerBase × qtyBase.
 * - The cart discount is allocated pro-rata across line nets (largest
 *   remainder to the last line) so every sale_line foots to the sale totals.
 * - Per-line tax is rounded half-up: inclusive classes extract
 *   `taxable × rate / (10000 + rate)`, exclusive classes add
 *   `taxable × rate / 10000`.
 * - Optional cash rounding (`pos.cash_rounding`) rounds the payable total to
 *   the configured increment when at least one payment is cash.
 *
 * M2 block: any `requires_rx` or controlled product rejects the whole cart —
 * prescriptions and controlled sales arrive in M3 (no override exists).
 */

export const checkoutLineSchema = z.object({
  productId: z.string().trim().min(1).max(40),
  unitId: z.string().trim().min(1).max(40),
  qtyBase: z.number().int().min(1).max(1_000_000),
  discountMinor: z.number().int().min(0).max(1_000_000_000).optional(),
});
export const checkoutPaymentSchema = z.object({
  method: z.enum(PAYMENT_METHODS),
  amountMinor: z.number().int().min(1).max(1_000_000_000),
  reference: z.string().trim().max(80).optional(),
});
export const checkoutSchema = z.object({
  lines: z.array(checkoutLineSchema).min(1).max(100),
  cartDiscountMinor: z.number().int().min(0).max(1_000_000_000).optional(),
  payments: z.array(checkoutPaymentSchema).min(1).max(8),
  approvalToken: z.string().trim().min(1).optional(),
});
export type { CheckoutInput };

const RX_BLOCKED_MESSAGE = "Prescription handling arrives in the next release.";

/** floor(a × b ÷ d) with the product kept exact — all operands are non-negative integers. */
function mulDiv(a: number, b: number, d: number): number {
  return Math.floor((a * b) / d);
}

/** round(a × b ÷ d) half-up, integer-only. */
function mulDivRoundHalfUp(a: number, b: number, d: number): number {
  return Math.floor((2 * a * b + d) / (2 * d));
}

/**
 * Splits `total` across `weights` proportionally, in integers, giving the
 * leftover minor units to the last line so the shares foot exactly.
 */
function allocateProportionally(total: number, weights: number[]): number[] {
  const sum = weights.reduce((acc, w) => acc + w, 0);
  if (total === 0 || sum === 0) return weights.map(() => 0);
  const shares = weights.map((w, i) => (i === weights.length - 1 ? 0 : mulDiv(total, w, sum)));
  shares[shares.length - 1] = total - shares.reduce((acc, s) => acc + s, 0);
  return shares;
}

interface SettledPayment {
  method: PaymentMethod;
  amount: number;
  tendered: number;
  change: number;
  reference: string | null;
}

/**
 * Normalizes tenders: non-cash applies its full amount and may not exceed the
 * remaining due; cash applies min(tendered, remaining) and returns the rest as
 * change. Rejects empty tenders, over-tendered non-cash and under-payment.
 */
function settlePayments(
  totalDue: number,
  payments: { method: PaymentMethod; amountMinor: number; reference?: string }[],
): SettledPayment[] {
  let remaining = totalDue;
  const settled: SettledPayment[] = [];
  for (const payment of payments) {
    if (remaining === 0) {
      throw new DomainError("BAD_PAYMENT", "Payments exceed the amount due.");
    }
    if (payment.method === "cash") {
      const applied = Math.min(payment.amountMinor, remaining);
      settled.push({
        method: "cash",
        amount: applied,
        tendered: payment.amountMinor,
        change: payment.amountMinor - applied,
        reference: payment.reference ?? null,
      });
      remaining -= applied;
    } else {
      if (payment.amountMinor > remaining) {
        throw new DomainError(
          "BAD_PAYMENT",
          "A non-cash payment cannot exceed the amount still due.",
        );
      }
      settled.push({
        method: payment.method,
        amount: payment.amountMinor,
        tendered: payment.amountMinor,
        change: 0,
        reference: payment.reference ?? null,
      });
      remaining -= payment.amountMinor;
    }
  }
  if (remaining > 0) {
    throw new DomainError("BAD_PAYMENT", "The payments do not cover the amount due.");
  }
  return settled;
}

interface PricedLine {
  productId: string;
  productName: string;
  sku: string;
  unitId: string;
  unitName: string;
  factorToBase: number;
  qtyBase: number;
  unitPriceMinor: number;
  /** Price per base unit actually used for the gross (exact or rounded loose price). */
  perBaseMinor: number;
  grossMinor: number;
  discountMinor: number;
  rateBp: number;
  priceIncludesTax: boolean;
}

export async function checkout(
  handle: DatabaseHandle,
  actor: SessionUser,
  rawInput: CheckoutInput,
  idempotencyKey: string,
): Promise<SaleReceipt> {
  requireCapability(actor, "pos.sell");
  const parsed = checkoutSchema.parse(rawInput);
  if (!idempotencyKey || idempotencyKey.length > 80) {
    throw new DomainError("BAD_INPUT", "A valid idempotency key is required.");
  }
  const branchId = requireBranch(actor);
  const tz = serverEnv().APP_TIMEZONE;
  const today = todayIso(tz);
  const [discountMaxPct, cashRounding] = await Promise.all([
    getDiscountMaxPct(handle.db),
    getCashRounding(handle.db),
  ]);
  const now = Date.now();
  const saleId = newId();

  try {
    return await withWriteTx(handle.client, async (tx) => {
      // ---- Idempotent replay --------------------------------------------
      const existing = await tx.execute({
        sql: "select id from sales where idempotency_key = ?",
        args: [idempotencyKey],
      });
      if (existing.rows.length > 0) {
        const stored = await loadReceiptTx(tx, String(existing.rows[0].id));
        return { ...stored, replayed: true };
      }

      // ---- Open shift ----------------------------------------------------
      const shift = await tx.execute({
        sql: `select id from shifts
              where user_id = ? and branch_id = ? and closed_at is null`,
        args: [actor.id, branchId],
      });
      if (shift.rows.length === 0) {
        throw new DomainError("NO_SHIFT", "Open a shift before selling.");
      }
      const shiftId = String(shift.rows[0].id);

      // ---- Re-price every line from the database -------------------------
      const priced: PricedLine[] = [];
      for (const line of parsed.lines) {
        const product = await tx.execute({
          sql: `select p.id, p.name, p.sku, p.requires_rx, p.controlled_schedule,
                       p.sellable_loose, p.active,
                       coalesce(t.rate_bp, 0) as rate_bp,
                       coalesce(t.price_includes_tax, 0) as price_includes_tax,
                       u.name as unit_name, u.factor_to_base
                from products p
                left join tax_classes t on t.id = p.tax_class_id
                join product_units u on u.id = ? and u.product_id = p.id
                where p.id = ?`,
          args: [line.unitId, line.productId],
        });
        if (product.rows.length === 0) {
          throw new DomainError("NOT_FOUND", `Unknown product or unit for ${line.productId}.`);
        }
        const row = product.rows[0];
        if (Number(row.active) !== 1) {
          throw new DomainError("INACTIVE", `${row.name} is deactivated.`);
        }
        if (Number(row.requires_rx) === 1 || row.controlled_schedule !== null) {
          throw new DomainError("RX_BLOCKED", RX_BLOCKED_MESSAGE);
        }
        const factor = Number(row.factor_to_base);
        if (line.qtyBase % factor !== 0 && Number(row.sellable_loose) !== 1) {
          throw new DomainError(
            "NOT_WHOLE_UNITS",
            `${row.name} is only sold in whole ${row.unit_name}(s) of ${factor}.`,
          );
        }
        const price = await tx.execute({
          sql: `select price from product_prices
                where product_id = ? and unit_id = ?
                  and effective_from <= ? and (effective_to is null or effective_to > ?)
                order by effective_from desc limit 1`,
          args: [line.productId, line.unitId, now, now],
        });
        if (price.rows.length === 0) {
          throw new DomainError("NO_PRICE", `No active price for ${row.name} (${row.unit_name}).`);
        }
        const unitPriceMinor = Number(price.rows[0].price);
        // Loose per-base price: unitPrice ÷ factor, rounded half-up (documented rule).
        const perBaseMinor =
          factor === 1 ? unitPriceMinor : mulDivRoundHalfUp(unitPriceMinor, 1, factor);
        const grossMinor = perBaseMinor * line.qtyBase;
        const discountMinor = line.discountMinor ?? 0;
        if (discountMinor > grossMinor) {
          throw new DomainError(
            "BAD_DISCOUNT",
            `The discount on ${row.name} exceeds its line total.`,
          );
        }
        priced.push({
          productId: line.productId,
          productName: String(row.name),
          sku: String(row.sku),
          unitId: line.unitId,
          unitName: String(row.unit_name),
          factorToBase: factor,
          qtyBase: line.qtyBase,
          unitPriceMinor,
          perBaseMinor,
          grossMinor,
          discountMinor,
          rateBp: Number(row.rate_bp),
          priceIncludesTax: Number(row.price_includes_tax) === 1,
        });
      }

      // ---- Discounts + approval gate --------------------------------------
      const subtotalMinor = priced.reduce((acc, l) => acc + l.grossMinor, 0);
      const lineDiscountsMinor = priced.reduce((acc, l) => acc + l.discountMinor, 0);
      const cartDiscountMinor = parsed.cartDiscountMinor ?? 0;
      const discountTotalMinor = lineDiscountsMinor + cartDiscountMinor;
      if (cartDiscountMinor > subtotalMinor - lineDiscountsMinor) {
        throw new DomainError("BAD_DISCOUNT", "The cart discount exceeds the payable subtotal.");
      }
      // Over the configured cap → a bound, single-use approval token is required.
      let discountApprover: string | null = null;
      if (discountTotalMinor * 100 > discountMaxPct * subtotalMinor) {
        if (!parsed.approvalToken) {
          throw new DomainError(
            "APPROVAL_REQUIRED",
            `Discounts above ${discountMaxPct}% need an owner or manager approval.`,
          );
        }
        discountApprover = (
          await consumeApproval(tx, {
            tokenId: parsed.approvalToken,
            requesterId: actor.id,
            action: "sale.discount_over_limit",
            payload: discountApprovalPayload({
              lines: parsed.lines.map((l) => ({
                productId: l.productId,
                unitId: l.unitId,
                qtyBase: l.qtyBase,
                discountMinor: l.discountMinor ?? 0,
              })),
              cartDiscountMinor,
            }),
          })
        ).approverId;
      }

      // ---- Per-line tax (half-up) ------------------------------------------
      const lineNets = priced.map((l) => l.grossMinor - l.discountMinor);
      const cartShares = allocateProportionally(cartDiscountMinor, lineNets);
      const taxable = priced.map((l, i) => lineNets[i] - cartShares[i]);
      const taxes = priced.map((l, i) => {
        if (l.rateBp === 0) return 0;
        return l.priceIncludesTax
          ? mulDivRoundHalfUp(taxable[i], l.rateBp, 10_000 + l.rateBp)
          : mulDivRoundHalfUp(taxable[i], l.rateBp, 10_000);
      });
      const lineTotals = priced.map((l, i) =>
        l.priceIncludesTax ? taxable[i] : taxable[i] + taxes[i],
      );
      const taxTotalMinor = taxes.reduce((acc, t) => acc + t, 0);
      const payableBeforeRounding = lineTotals.reduce((acc, t) => acc + t, 0);
      const hasCash = parsed.payments.some((p) => p.method === "cash");
      const totalMinor = hasCash
        ? applyCashRounding(payableBeforeRounding, cashRounding)
        : payableBeforeRounding;
      const roundingMinor = totalMinor - payableBeforeRounding;

      // ---- Settle payments -------------------------------------------------
      const settled = settlePayments(totalMinor, parsed.payments);

      // ---- FEFO allocation + conditional decrement ------------------------
      interface AllocatedLine {
        priced: PricedLine;
        batchId: string;
        batchNo: string;
        expiryDate: string;
        qtyBase: number;
        lineTotalMinor: number;
        taxMinor: number;
        discountMinor: number;
      }
      const allocated: AllocatedLine[] = [];
      for (let i = 0; i < priced.length; i++) {
        const line = priced[i];
        const candidates = await tx.execute({
          sql: `select id, batch_no, expiry_date, qty_remaining
                from batches
                where product_id = ? and branch_id = ? and qty_remaining > 0
                order by expiry_date asc`,
          args: [line.productId, branchId],
        });
        // FEFO: earliest unexpired first; expired stock is never sold.
        const usable = candidates.rows
          .filter((r) => String(r.expiry_date) >= today)
          .map((r) => ({
            batchId: String(r.id),
            batchNo: String(r.batch_no),
            expiryDate: String(r.expiry_date),
            qtyRemaining: Number(r.qty_remaining),
          }));
        const splits: { batch: (typeof usable)[number]; qty: number }[] = [];
        let left = line.qtyBase;
        for (const batch of usable) {
          const take = Math.min(batch.qtyRemaining, left);
          splits.push({ batch, qty: take });
          left -= take;
          if (left === 0) break;
        }
        if (left > 0) {
          throw await stockChanged(
            tx,
            branchId,
            parsed.lines.map((l) => l.productId),
          );
        }
        // Proportional split of the line total/tax/discount across batch
        // allocations, remainder to the last allocation so lines foot exactly.
        const splitQtys = splits.map((s) => s.qty);
        const totalShares = allocateProportionally(lineTotals[i], splitQtys);
        const taxShares = allocateProportionally(taxes[i], splitQtys);
        const discountShares = allocateProportionally(
          line.discountMinor + cartShares[i],
          splitQtys,
        );
        for (let j = 0; j < splits.length; j++) {
          const { batch, qty } = splits[j];
          const decremented = await tx.execute({
            sql: `update batches set qty_remaining = qty_remaining - ?, updated_at = ?
                  where id = ? and qty_remaining >= ?`,
            args: [qty, now, batch.batchId, qty],
          });
          if (decremented.rowsAffected !== 1) {
            throw await stockChanged(
              tx,
              branchId,
              parsed.lines.map((l) => l.productId),
            );
          }
          allocated.push({
            priced: line,
            batchId: batch.batchId,
            batchNo: batch.batchNo,
            expiryDate: batch.expiryDate,
            qtyBase: qty,
            lineTotalMinor: totalShares[j],
            taxMinor: taxShares[j],
            discountMinor: discountShares[j],
          });
        }
      }

      // ---- Receipt number (same transaction → no gaps) ----------------------
      await tx.execute({
        sql: `insert into receipt_counters (branch_id, next_no, created_at, updated_at)
              values (?, 1, ?, ?) on conflict(branch_id) do nothing`,
        args: [branchId, now, now],
      });
      await tx.execute({
        sql: "update receipt_counters set next_no = next_no + 1, updated_at = ? where branch_id = ?",
        args: [now, branchId],
      });
      const counter = await tx.execute({
        sql: "select next_no from receipt_counters where branch_id = ?",
        args: [branchId],
      });
      const receiptNo = Number(counter.rows[0].next_no) - 1;

      // ---- Persist the sale -------------------------------------------------
      await tx.execute({
        sql: `insert into sales
              (id, receipt_no, branch_id, shift_id, cashier_id, status, idempotency_key,
               subtotal, discount_total, tax_total, total, rounding, created_at, updated_at)
              values (?,?,?,?,?,'completed',?,?,?,?,?,?,?,?)`,
        args: [
          saleId,
          receiptNo,
          branchId,
          shiftId,
          actor.id,
          idempotencyKey,
          subtotalMinor,
          discountTotalMinor,
          taxTotalMinor,
          totalMinor,
          roundingMinor,
          now,
          now,
        ],
      });
      const receiptLines: ReceiptLine[] = [];
      for (let i = 0; i < allocated.length; i++) {
        const alloc = allocated[i];
        const saleLineId = newId();
        await tx.execute({
          sql: `insert into sale_lines
                (id, sale_id, product_id, batch_id, unit_id, qty_base, unit_price,
                 discount, tax_rate, tax_amount, line_total, created_at, updated_at)
                values (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          args: [
            saleLineId,
            saleId,
            alloc.priced.productId,
            alloc.batchId,
            alloc.priced.unitId,
            alloc.qtyBase,
            alloc.priced.unitPriceMinor,
            alloc.discountMinor,
            alloc.priced.rateBp,
            alloc.taxMinor,
            alloc.lineTotalMinor,
            now,
            now,
          ],
        });
        await tx.execute({
          sql: `insert into stock_movements
                (id, batch_id, type, qty_delta, ref_type, ref_id, reason, user_id, at, created_at)
                values (?,?,'sale',?,?,?,?,?,?,?)`,
          args: [
            newId(),
            alloc.batchId,
            -alloc.qtyBase,
            "sale",
            saleId,
            `receipt ${receiptNo}`,
            actor.id,
            now,
            now,
          ],
        });
        receiptLines.push({
          productName: alloc.priced.productName,
          sku: alloc.priced.sku,
          unitName: alloc.priced.unitName,
          factorToBase: alloc.priced.factorToBase,
          qtyBase: alloc.qtyBase,
          unitPriceMinor: alloc.priced.unitPriceMinor,
          discountMinor: alloc.discountMinor,
          taxRateBp: alloc.priced.rateBp,
          taxMinor: alloc.taxMinor,
          lineTotalMinor: alloc.lineTotalMinor,
          batchNo: alloc.batchNo,
          expiryDate: alloc.expiryDate,
        });
      }
      if (cartDiscountMinor > 0) {
        await tx.execute({
          sql: `insert into sale_discounts (id, sale_id, type, amount, created_at, updated_at)
                values (?,?,'manual_cart',?,?,?)`,
          args: [newId(), saleId, cartDiscountMinor, now, now],
        });
      }
      if (lineDiscountsMinor > 0) {
        await tx.execute({
          sql: `insert into sale_discounts (id, sale_id, type, amount, created_at, updated_at)
                values (?,?,'manual_line',?,?,?)`,
          args: [newId(), saleId, lineDiscountsMinor, now, now],
        });
      }
      const receiptPayments: ReceiptPayment[] = [];
      for (const payment of settled) {
        await tx.execute({
          sql: `insert into payments
                (id, sale_id, method, amount, tendered, change_given, reference, created_at, updated_at)
                values (?,?,?,?,?,?,?,?,?)`,
          args: [
            newId(),
            saleId,
            payment.method,
            payment.amount,
            payment.tendered,
            payment.change,
            payment.reference,
            now,
            now,
          ],
        });
        receiptPayments.push({
          method: payment.method,
          amountMinor: payment.amount,
          tenderedMinor: payment.tendered,
          changeMinor: payment.change,
          reference: payment.reference,
        });
      }

      await tx.execute(
        await buildAuditStatement({
          userId: actor.id,
          action: "sale.completed",
          entity: "sales",
          entityId: saleId,
          after: {
            receiptNo,
            shiftId,
            totalMinor,
            discountTotalMinor,
            taxTotalMinor,
            lines: allocated.map((a) => ({
              productId: a.priced.productId,
              batchNo: a.batchNo,
              qtyBase: a.qtyBase,
              lineTotalMinor: a.lineTotalMinor,
            })),
            payments: settled.map((p) => ({ method: p.method, amount: p.amount })),
            discountApprovedBy: discountApprover,
          },
        }),
      );

      const branch = await tx.execute({
        sql: "select name, address, tax_id from branches where id = ?",
        args: [branchId],
      });
      const branchRow = branch.rows[0] ?? { name: "", address: null, tax_id: null };

      return {
        saleId,
        receiptNo,
        branchId,
        at: now,
        status: "completed",
        cashierName: actor.name ?? actor.email,
        storeName: String(branchRow.name),
        storeAddress: branchRow.address === null ? null : String(branchRow.address),
        storeTaxId: branchRow.tax_id === null ? null : String(branchRow.tax_id),
        lines: receiptLines,
        subtotalMinor,
        lineDiscountsMinor,
        cartDiscountMinor,
        discountTotalMinor,
        taxTotalMinor,
        roundingMinor,
        totalMinor,
        payments: receiptPayments,
        changeMinor: settled.reduce((acc, p) => acc + p.change, 0),
      };
    });
  } catch (error) {
    // A concurrent same-key request can pass the SELECT then lose the UNIQUE
    // insert race — fall back to the stored receipt (true idempotent replay).
    if (error instanceof Error && /unique|constraint/i.test(error.message)) {
      const stored = await getReceiptByKey(handle, actor, idempotencyKey);
      if (stored) return { ...stored, replayed: true };
    }
    throw error;
  }
}

async function stockChanged(
  tx: Transaction,
  branchId: string,
  productIds: string[],
): Promise<DomainError> {
  const availability: StockAvailability[] = [];
  for (const productId of [...new Set(productIds)]) {
    const rs = await tx.execute({
      sql: `select coalesce(sum(qty_remaining), 0) as qty from batches
            where product_id = ? and branch_id = ? and expiry_date >= ?`,
      args: [productId, branchId, todayIso(serverEnv().APP_TIMEZONE)],
    });
    availability.push({ productId, availableBase: Number(rs.rows[0].qty) });
  }
  return new DomainError(
    "STOCK_CHANGED",
    "Stock changed while the sale was processing — review the updated availability and try again.",
    availability,
  );
}

/** Receipt reconstruction inside an open transaction (idempotent replay path). */
async function loadReceiptTx(tx: Transaction, saleId: string): Promise<SaleReceipt> {
  const sale = await tx.execute({
    sql: `select s.id, s.receipt_no, s.branch_id, s.created_at, s.status,
                 s.subtotal, s.discount_total, s.tax_total, s.total, s.rounding,
                 coalesce(u.name, u.email) as cashier_name,
                 br.name as store_name, br.address as store_address, br.tax_id as store_tax_id
          from sales s
          join users u on u.id = s.cashier_id
          join branches br on br.id = s.branch_id
          where s.id = ?`,
    args: [saleId],
  });
  const row = sale.rows[0];
  const cartRow = await tx.execute({
    sql: "select amount from sale_discounts where sale_id = ? and type = 'manual_cart'",
    args: [saleId],
  });
  const cartDiscount = cartRow.rows.length > 0 ? Number(cartRow.rows[0].amount) : 0;
  const lines = await tx.execute({
    sql: `select sl.qty_base, sl.unit_price, sl.discount, sl.tax_rate, sl.tax_amount,
                 sl.line_total, b.batch_no, b.expiry_date,
                 p.name as product_name, p.sku, u.name as unit_name, u.factor_to_base
          from sale_lines sl
          join products p on p.id = sl.product_id
          join product_units u on u.id = sl.unit_id
          join batches b on b.id = sl.batch_id
          where sl.sale_id = ? order by sl.rowid asc`,
    args: [saleId],
  });
  const payments = await tx.execute({
    sql: `select method, amount, tendered, change_given, reference
          from payments where sale_id = ? order by rowid asc`,
    args: [saleId],
  });
  const receiptPayments: ReceiptPayment[] = payments.rows.map((p) => ({
    method: String(p.method) as PaymentMethod,
    amountMinor: Number(p.amount),
    tenderedMinor: p.tendered === null ? Number(p.amount) : Number(p.tendered),
    changeMinor: Number(p.change_given),
    reference: p.reference === null ? null : String(p.reference),
  }));
  return {
    saleId: String(row.id),
    receiptNo: Number(row.receipt_no),
    branchId: String(row.branch_id),
    at: Number(row.created_at),
    status: String(row.status),
    cashierName: String(row.cashier_name),
    storeName: String(row.store_name),
    storeAddress: row.store_address === null ? null : String(row.store_address),
    storeTaxId: row.store_tax_id === null ? null : String(row.store_tax_id),
    lines: lines.rows.map((l) => ({
      productName: String(l.product_name),
      sku: String(l.sku),
      unitName: String(l.unit_name),
      factorToBase: Number(l.factor_to_base),
      qtyBase: Number(l.qty_base),
      unitPriceMinor: Number(l.unit_price),
      discountMinor: Number(l.discount),
      taxRateBp: Number(l.tax_rate),
      taxMinor: Number(l.tax_amount),
      lineTotalMinor: Number(l.line_total),
      batchNo: String(l.batch_no),
      expiryDate: String(l.expiry_date),
    })),
    subtotalMinor: Number(row.subtotal),
    lineDiscountsMinor: Number(row.discount_total) - cartDiscount,
    cartDiscountMinor: cartDiscount,
    discountTotalMinor: Number(row.discount_total),
    taxTotalMinor: Number(row.tax_total),
    roundingMinor: Number(row.rounding),
    totalMinor: Number(row.total),
    payments: receiptPayments,
    changeMinor: receiptPayments.reduce((acc, p) => acc + p.changeMinor, 0),
  };
}

async function getReceiptByKey(
  handle: DatabaseHandle,
  actor: SessionUser,
  idempotencyKey: string,
): Promise<SaleReceipt | null> {
  const rs = await handle.client.execute({
    sql: "select id from sales where idempotency_key = ?",
    args: [idempotencyKey],
  });
  if (rs.rows.length === 0) return null;
  return getReceipt(handle, actor, String(rs.rows[0].id));
}

/** Reprint loads the receipt and records an audit row (spec FR-POS-8). */
export async function reprintSale(
  handle: DatabaseHandle,
  actor: SessionUser,
  saleId: string,
): Promise<SaleReceipt> {
  requireCapability(actor, "sales.view");
  const receipt = await getReceipt(handle, actor, saleId);
  await recordAudit(
    {
      userId: actor.id,
      action: "sale.reprinted",
      entity: "sales",
      entityId: saleId,
      after: { receiptNo: receipt.receiptNo },
    },
    handle.db,
  );
  return receipt;
}

function requireBranch(actor: SessionUser): string {
  if (!actor.branchId) {
    throw new DomainError("NO_BRANCH", "Your account is not assigned to a branch.");
  }
  return actor.branchId;
}
