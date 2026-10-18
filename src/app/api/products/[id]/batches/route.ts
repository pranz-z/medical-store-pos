import { NextResponse } from "next/server";

import { getDatabase } from "@/db/client";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/permissions";

/**
 * `GET /api/products/:id/batches` — batch pick-list for the adjustment form:
 * batch id, number, expiry and remaining quantity for the caller's branch.
 * Restricted to roles that can view inventory.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user || !can(user.role, "inventory.view")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!user.branchId) return NextResponse.json({ batches: [] });

  const { id } = await params;
  const { client } = getDatabase();
  const response = await client.execute({
    sql: `select b.id, b.batch_no, b.expiry_date, b.qty_remaining, b.cost_per_base_unit
          from batches b join products p on p.id = b.product_id
          where b.product_id = ? and b.branch_id = ? and p.active = 1
          order by b.expiry_date asc`,
    args: [id, user.branchId],
  });

  return NextResponse.json({
    batches: response.rows.map((row) => ({
      id: String(row.id),
      batchNo: String(row.batch_no),
      expiryDate: String(row.expiry_date),
      qtyRemaining: Number(row.qty_remaining),
      costPerBaseUnitMinor: Number(row.cost_per_base_unit),
    })),
  });
}
