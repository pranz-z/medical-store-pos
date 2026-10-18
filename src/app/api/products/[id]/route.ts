import { NextResponse } from "next/server";

import { getDatabase } from "@/db/client";
import { getSessionUser } from "@/lib/auth/session";
import { todayIso } from "@/lib/dates";
import { serverEnv } from "@/lib/env";
import { can } from "@/lib/permissions";
import { getProductHit } from "@/lib/product-search";

/**
 * `GET /api/products/[id]` — one hydrated product hit (same shape as search):
 * units, current prices and non-expired stock. The POS uses it to re-validate
 * held carts before checkout; only active products are returned.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user || !can(user.role, "catalog.view")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (!user.branchId) {
    return NextResponse.json({ product: null });
  }
  const { client } = getDatabase();
  const product = await getProductHit(client, id, {
    branchId: user.branchId,
    todayIso: todayIso(serverEnv().APP_TIMEZONE),
  });
  if (!product) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ product });
}
