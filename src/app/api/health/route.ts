import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/db/client";

/**
 * Liveness/readiness probe (spec §9): confirms the app can reach Turso.
 * Public by design and deliberately free of any store data or secrets.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = Date.now();
  const checkedAt = new Date().toISOString();

  try {
    await getDb().run(sql`select 1`);
    return NextResponse.json({
      status: "ok",
      checks: { database: "ok" },
      latencyMs: Date.now() - startedAt,
      checkedAt,
    });
  } catch {
    return NextResponse.json(
      {
        status: "degraded",
        checks: { database: "unreachable" },
        checkedAt,
      },
      { status: 503 },
    );
  }
}
