import { toNextJsHandler } from "better-auth/next-js";

import { auth } from "@/lib/auth/auth";

/**
 * Better Auth catch-all route handler.
 *
 * Only the endpoints Better Auth still serves are reachable here — sign-in and
 * sign-up paths are disabled via `disabledPaths` and go through server actions.
 * `/api/auth/get-session` etc. stay available for client-side session checks.
 */
export const { GET, POST } = toNextJsHandler(auth);
