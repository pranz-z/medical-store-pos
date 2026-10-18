import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { IMPORT_TEMPLATE } from "@/lib/product-import";

/**
 * `GET /api/products/import-template` — downloadable CSV header + example row
 * for the bulk product import (spec §3.2). Import-capable roles only.
 */
export const runtime = "nodejs";

export async function GET() {
  const user = await getSessionUser();
  if (!user || !can(user.role, "catalog.import")) {
    return new Response("unauthorized", { status: 401 });
  }
  return new Response(IMPORT_TEMPLATE, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="product-import-template.csv"',
    },
  });
}
