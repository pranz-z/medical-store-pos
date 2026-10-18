import type { Client } from "@libsql/client";

import { addDaysIso } from "@/lib/dates";

/**
 * Read models for the inventory screens (spec §3.3): batch list with alert
 * filters, alert summary counts, and the stock-movement ledger. All reads are
 * plain SQL over the libSQL client — pages pass `getDatabase().client`.
 */

export type BatchFilter = "all" | "low" | "exp30" | "exp60" | "exp90" | "expired";

export const BATCH_FILTERS: { id: BatchFilter; label: string }[] = [
  { id: "all", label: "All batches" },
  { id: "low", label: "Low stock" },
  { id: "exp30", label: "Expiring in 30 days" },
  { id: "exp60", label: "Expiring in 60 days" },
  { id: "exp90", label: "Expiring in 90 days" },
  { id: "expired", label: "Expired on shelf" },
];

export interface BatchRow {
  batchId: string;
  productId: string;
  productName: string;
  sku: string;
  batchNo: string;
  expiryDate: string;
  qtyReceived: number;
  qtyRemaining: number;
  costPerBaseUnitMinor: number;
  supplierName: string | null;
  receivedAt: string;
  reorderLevel: number;
  /** Non-expired on-hand for the whole product (for the low-stock column). */
  productOnHand: number;
  daysToExpiry: number;
}

export interface InventoryAlertCounts {
  lowStockProducts: number;
  expiring30: number;
  expiring60: number;
  expiring90: number;
  expiredBatches: number;
}

const ON_HAND_SUBQUERY = `coalesce((
  select sum(b2.qty_remaining) from batches b2
  where b2.product_id = b.product_id and b2.branch_id = b.branch_id
    and b2.qty_remaining > 0 and b2.expiry_date >= ?
), 0)`;

export async function listBatches(
  client: Client,
  options: {
    branchId: string;
    today: string;
    filter: BatchFilter;
    productId?: string;
    limit?: number;
    offset?: number;
  },
): Promise<BatchRow[]> {
  const limit = Math.min(options.limit ?? 200, 500);
  const offset = options.offset ?? 0;
  const exp30 = addDaysIso(options.today, 30);
  const exp60 = addDaysIso(options.today, 60);
  const exp90 = addDaysIso(options.today, 90);

  const conditions = ["b.branch_id = ?"];
  const args: (string | number)[] = [options.branchId];

  if (options.productId) {
    conditions.push("b.product_id = ?");
    args.push(options.productId);
  }

  switch (options.filter) {
    case "low":
      // Low = product's non-expired on-hand at or under its reorder level.
      conditions.push(`p.reorder_level > 0 and ${ON_HAND_SUBQUERY} <= p.reorder_level`);
      args.push(options.today);
      break;
    case "exp30":
      conditions.push("b.qty_remaining > 0 and b.expiry_date >= ? and b.expiry_date <= ?");
      args.push(options.today, exp30);
      break;
    case "exp60":
      conditions.push("b.qty_remaining > 0 and b.expiry_date >= ? and b.expiry_date <= ?");
      args.push(options.today, exp60);
      break;
    case "exp90":
      conditions.push("b.qty_remaining > 0 and b.expiry_date >= ? and b.expiry_date <= ?");
      args.push(options.today, exp90);
      break;
    case "expired":
      conditions.push("b.qty_remaining > 0 and b.expiry_date < ?");
      args.push(options.today);
      break;
    case "all":
      break;
  }

  const response = await client.execute({
    sql: `select b.id, b.product_id, p.name as product_name, p.sku, p.reorder_level,
                 b.batch_no, b.expiry_date, b.qty_received, b.qty_remaining,
                 b.cost_per_base_unit, b.received_at, s.name as supplier_name,
                 ${ON_HAND_SUBQUERY} as product_on_hand,
                 cast(julianday(b.expiry_date) - julianday(?) as integer) as days_to_expiry
          from batches b
          join products p on p.id = b.product_id
          left join suppliers s on s.id = b.supplier_id
          where ${conditions.join(" and ")}
          order by b.expiry_date asc, p.name asc
          limit ? offset ?`,
    args: [...args, options.today, options.today, limit, offset],
  });

  return response.rows.map((row) => ({
    batchId: String(row.id),
    productId: String(row.product_id),
    productName: String(row.product_name),
    sku: String(row.sku),
    batchNo: String(row.batch_no),
    expiryDate: String(row.expiry_date),
    qtyReceived: Number(row.qty_received),
    qtyRemaining: Number(row.qty_remaining),
    costPerBaseUnitMinor: Number(row.cost_per_base_unit),
    supplierName: row.supplier_name === null ? null : String(row.supplier_name),
    receivedAt: new Date(Number(row.received_at)).toISOString().slice(0, 10),
    reorderLevel: Number(row.reorder_level),
    productOnHand: Number(row.product_on_hand),
    daysToExpiry: Number(row.days_to_expiry),
  }));
}

export async function inventoryAlertCounts(
  client: Client,
  options: { branchId: string; today: string },
): Promise<InventoryAlertCounts> {
  const { branchId, today } = options;
  const exp30 = addDaysIso(today, 30);
  const exp60 = addDaysIso(today, 60);
  const exp90 = addDaysIso(today, 90);

  const [low, buckets] = await Promise.all([
    client.execute({
      sql: `select count(*) as n from (
              select p.id from products p
              left join batches b on b.product_id = p.id and b.branch_id = ?
                and b.qty_remaining > 0 and b.expiry_date >= ?
              where p.active = 1 and p.reorder_level > 0
              group by p.id
              having coalesce(sum(b.qty_remaining), 0) <= p.reorder_level
            )`,
      args: [branchId, today],
    }),
    client.execute({
      sql: `select
              sum(case when expiry_date <= ? then 1 else 0 end) as e30,
              sum(case when expiry_date <= ? then 1 else 0 end) as e60,
              sum(case when expiry_date <= ? then 1 else 0 end) as e90,
              sum(case when expiry_date < ? then 1 else 0 end) as expired
            from batches
            where branch_id = ? and qty_remaining > 0 and expiry_date >= ?`,
      args: [exp30, exp60, exp90, today, branchId, today],
    }),
  ]);

  const expiredCount = await client.execute({
    sql: `select count(*) as n from batches
          where branch_id = ? and qty_remaining > 0 and expiry_date < ?`,
    args: [branchId, today],
  });

  return {
    lowStockProducts: Number(low.rows[0]?.n ?? 0),
    expiring30: Number(buckets.rows[0]?.e30 ?? 0),
    expiring60: Number(buckets.rows[0]?.e60 ?? 0),
    expiring90: Number(buckets.rows[0]?.e90 ?? 0),
    expiredBatches: Number(expiredCount.rows[0]?.n ?? 0),
  };
}

export interface MovementRow {
  id: string;
  at: string;
  type: string;
  qtyDelta: number;
  batchId: string;
  batchNo: string;
  productId: string;
  productName: string;
  sku: string;
  reason: string | null;
  refType: string | null;
  userName: string | null;
}

/** Stock-movement ledger (spec §3.7 "stock movement ledger"), newest first. */
export async function listMovements(
  client: Client,
  options: {
    branchId: string;
    batchId?: string;
    productId?: string;
    limit?: number;
  },
): Promise<MovementRow[]> {
  const limit = Math.min(options.limit ?? 200, 500);
  const conditions = ["b.branch_id = ?"];
  const args: (string | number)[] = [options.branchId];
  if (options.batchId) {
    conditions.push("m.batch_id = ?");
    args.push(options.batchId);
  }
  if (options.productId) {
    conditions.push("b.product_id = ?");
    args.push(options.productId);
  }

  const response = await client.execute({
    sql: `select m.id, m.at, m.type, m.qty_delta, m.batch_id, b.batch_no,
                 b.product_id, p.name as product_name, p.sku,
                 m.reason, m.ref_type, u.name as user_name
          from stock_movements m
          join batches b on b.id = m.batch_id
          join products p on p.id = b.product_id
          left join users u on u.id = m.user_id
          where ${conditions.join(" and ")}
          order by m.at desc, m.id desc
          limit ?`,
    args: [...args, limit],
  });

  return response.rows.map((row) => ({
    id: String(row.id),
    at: new Date(Number(row.at)).toISOString(),
    type: String(row.type),
    qtyDelta: Number(row.qty_delta),
    batchId: String(row.batch_id),
    batchNo: String(row.batch_no),
    productId: String(row.product_id),
    productName: String(row.product_name),
    sku: String(row.sku),
    reason: row.reason === null ? null : String(row.reason),
    refType: row.ref_type === null ? null : String(row.ref_type),
    userName: row.user_name === null ? null : String(row.user_name),
  }));
}
