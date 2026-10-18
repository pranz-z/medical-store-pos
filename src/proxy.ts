import { NextResponse, type NextRequest } from "next/server";

import { REQUEST_ID_HEADER } from "@/lib/http";

/**
 * Request ID proxy (Next 16 file convention is `proxy.ts`, previous name
 * `middleware.ts`).
 *
 * Stamps every request with `x-request-id` (honoring an upstream value when
 * present) so audit rows and log lines can be correlated without logging PII.
 * Auth gating is deliberately NOT done here — it lives in server components
 * (spec §9 keeps authorization close to the data).
 */
export function proxy(request: NextRequest): NextResponse {
  const requestId = request.headers.get(REQUEST_ID_HEADER) ?? crypto.randomUUID();

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(REQUEST_ID_HEADER, requestId);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
