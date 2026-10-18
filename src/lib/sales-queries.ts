import type { DatabaseHandle } from "@/db/client";
import type { SessionUser } from "@/lib/auth/session";
import { calendarDayRangeUtc } from "@/lib/dates";
import { serverEnv } from "@/lib/env";
import { DomainError } from "@/lib/errors";
import { requireCapability } from "@/lib/permissions";
import type { PaymentMethod, ReceiptLine, ReceiptPayment, SaleReceipt } from "@/lib/pos-shared";

/**
 * Read-side sales queries (history, receipt view, idempotent replay loading).
 * All functions enforce `sales.view` server-side.
 */

export async function getReceipt(
  handle: DatabaseHandle,
  actor: SessionUser,
  saleId: string,
): Promise<SaleReceipt> {
  requireCapability(actor, "sales.view");
  if (!actor.branchId)
    throw new DomainError("NO_BRANCH", "Your account is not assigned to a branch.");

  const sale = await handle.client.execute({
    sql: `select s.id, s.receipt_no, s.branch_id, s.created_at, s.status,
                 s.subtotal, s.discount_total, s.tax_total, s.total, s.rounding,
                 coalesce(u.name, u.email) as cashier_name,
                 br.name as store_name, br.address as store_address, br.tax_id as store_tax_id
          from sales s
          join users u on u.id = s.cashier_id
          join branches br on br.id = s.branch_id
          where s.id = ? and s.branch_id = ?`,
    args: [saleId, actor.branchId],
  });
  if (sale.rows.length === 0) throw new DomainError("NOT_FOUND", "Sale not found.");
  const row = sale.rows[0];

  const cartRow = await handle.client.execute({
    sql: "select amount from sale_discounts where sale_id = ? and type = 'manual_cart'",
    args: [saleId],
  });
  const cartDiscount = cartRow.rows.length > 0 ? Number(cartRow.rows[0].amount) : 0;

  const lines = await handle.client.execute({
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
  const payments = await handle.client.execute({
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
  const receiptLines: ReceiptLine[] = lines.rows.map((l) => ({
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
    lines: receiptLines,
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

export interface SaleListRow {
  id: string;
  receiptNo: number;
  at: number;
  cashierName: string;
  status: string;
  totalMinor: number;
  lineCount: number;
  methods: string;
}

/** Sales history for the branch, filtered by calendar date and/or cashier. */
export async function listSales(
  handle: DatabaseHandle,
  actor: SessionUser,
  filter: { date?: string; cashierId?: string; limit?: number } = {},
): Promise<SaleListRow[]> {
  requireCapability(actor, "sales.view");
  if (!actor.branchId)
    throw new DomainError("NO_BRANCH", "Your account is not assigned to a branch.");

  const clauses = ["s.branch_id = ?"];
  const args: (string | number)[] = [actor.branchId];
  if (filter.date) {
    // created_at is epoch ms; the calendar day is bounded in APP_TIMEZONE.
    const { startMs, endMs } = calendarDayRangeUtc(filter.date, serverEnv().APP_TIMEZONE);
    clauses.push("s.created_at >= ? and s.created_at < ?");
    args.push(startMs, endMs);
  }
  if (filter.cashierId) {
    clauses.push("s.cashier_id = ?");
    args.push(filter.cashierId);
  }
  args.push(Math.min(Math.max(filter.limit ?? 200, 1), 500));

  const rs = await handle.client.execute({
    sql: `select s.id, s.receipt_no, s.created_at, s.status, s.total,
                 coalesce(u.name, u.email) as cashier_name,
                 (select count(*) from sale_lines sl where sl.sale_id = s.id) as line_count,
                 coalesce((select group_concat(distinct p.method) from payments p
                           where p.sale_id = s.id), '') as methods
          from sales s join users u on u.id = s.cashier_id
          where ${clauses.join(" and ")}
          order by s.created_at desc limit ?`,
    args,
  });
  return rs.rows.map((row) => ({
    id: String(row.id),
    receiptNo: Number(row.receipt_no),
    at: Number(row.created_at),
    cashierName: String(row.cashier_name),
    status: String(row.status),
    totalMinor: Number(row.total),
    lineCount: Number(row.line_count),
    methods: String(row.methods),
  }));
}

/** Cashier names for the history filter dropdown. */
export async function listCashiers(
  handle: DatabaseHandle,
  actor: SessionUser,
): Promise<{ id: string; name: string }[]> {
  requireCapability(actor, "sales.view");
  if (!actor.branchId)
    throw new DomainError("NO_BRANCH", "Your account is not assigned to a branch.");
  const rs = await handle.client.execute({
    sql: `select distinct u.id, coalesce(u.name, u.email) as name
          from sales s join users u on u.id = s.cashier_id
          where s.branch_id = ? order by name`,
    args: [actor.branchId],
  });
  return rs.rows.map((row) => ({ id: String(row.id), name: String(row.name) }));
}
