import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { getDatabase } from "@/db/client";
import { getSessionUser } from "@/lib/auth/session";
import { ForbiddenError } from "@/lib/authz";
import { DomainError } from "@/lib/errors";
import { checkout } from "@/lib/sales-mutations";

/**
 * `POST /api/sales` — checkout (spec §6.1). Requires an `Idempotency-Key`
 * header; the server re-prices every line, allocates FEFO stock, settles
 * split tender and allocates the receipt number inside one write transaction.
 * Replays of the same key return the stored receipt (`replayed: true`).
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const actor = await getSessionUser();
  if (!actor) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const idempotencyKey = request.headers.get("idempotency-key")?.trim();
  if (!idempotencyKey) {
    return NextResponse.json(
      { error: "missing_idempotency_key", message: "The Idempotency-Key header is required." },
      { status: 400 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "bad_json", message: "Request body must be JSON." },
      { status: 400 },
    );
  }

  try {
    const receipt = await checkout(getDatabase(), actor, body as never, idempotencyKey);
    return NextResponse.json({ receipt });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: "bad_request", message: error.issues[0]?.message ?? "Invalid request." },
        { status: 400 },
      );
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: "forbidden", message: error.message }, { status: 403 });
    }
    if (error instanceof DomainError) {
      const status =
        error.code === "STOCK_CHANGED" || error.code === "APPROVAL_REQUIRED" ? 409 : 422;
      return NextResponse.json(
        { error: error.code.toLowerCase(), message: error.message, details: error.details ?? null },
        { status },
      );
    }
    throw error;
  }
}
