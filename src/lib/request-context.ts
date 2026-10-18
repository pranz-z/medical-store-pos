import { headers } from "next/headers";

import { REQUEST_ID_HEADER } from "@/lib/http";

/**
 * Request-scoped metadata used by audit entries and rate limiting.
 *
 * `x-request-id` is set by `src/proxy.ts` (and honored if an upstream already
 * set it). IP addresses are stored on audit rows for accountability but must
 * never be logged as free text (spec §9).
 */
export interface RequestContext {
  requestId: string | null;
  ip: string | null;
  userAgent: string | null;
}

export async function requestContext(): Promise<RequestContext> {
  const store = await headers();

  const forwardedFor = store.get("x-forwarded-for");
  const ip = forwardedFor?.split(",")[0]?.trim() || store.get("x-real-ip") || null;

  return {
    requestId: store.get(REQUEST_ID_HEADER),
    ip,
    userAgent: store.get("user-agent"),
  };
}
