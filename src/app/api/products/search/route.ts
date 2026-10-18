import { NextResponse } from "next/server";

import { getDatabase } from "@/db/client";
import { getSessionUser } from "@/lib/auth/session";
import { todayIso } from "@/lib/dates";
import { serverEnv } from "@/lib/env";
import { can } from "@/lib/permissions";
import { searchProducts } from "@/lib/product-search";

/**
 * `GET /api/products/search?q=` (spec §7): barcode + FTS search returning the
 * product, its units with current prices, and non-expired on-hand stock.
 * Every authenticated role may search (cashiers need it at the POS); callers
 * with no branch assigned get an empty result set.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user || !can(user.role, "catalog.view")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? "";
  const limitParam = Number(url.searchParams.get("limit"));
  const limit = Number.isInteger(limitParam) && limitParam > 0 ? limitParam : 20;

  if (!user.branchId) {
    return NextResponse.json({ products: [] });
  }

  const { client } = getDatabase();
  const products = await searchProducts(client, q, {
    branchId: user.branchId,
    todayIso: todayIso(serverEnv().APP_TIMEZONE),
    limit,
  });
  return NextResponse.json({ products });
}
