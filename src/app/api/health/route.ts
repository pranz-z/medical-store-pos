import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/db/client";

/**
 * Liveness/readiness probe (spec §9): confirms the app can reach Turso.
 * Public by design and deliberately free of any store data or secrets — the
 * response is exactly `{ status, db }` and nothing else.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await getDb().run(sql`select 1`);
    return NextResponse.json({ status: "ok", db: "ok" });
  } catch {
    return NextResponse.json({ status: "degraded", db: "unreachable" }, { status: 503 });
  }
}
