import { eq } from "drizzle-orm";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";

import { getDb } from "@/db/client";
import { accounts, sessions, users, verifications } from "@/db/schema/auth";
import { serverEnv } from "@/lib/env";
import { newId } from "@/lib/ids";

/**
 * Better Auth instance (M0 decision: Better Auth with DB-backed sessions,
 * scrypt password hashing — no native Argon2id dependency).
 *
 * Key choices:
 * - IDs come from our monotonic-ULID generator so auth rows match every other
 *   table (spec §5 conventions).
 * - `role`, `branchId` and `active` are exposed as user additional fields, so
 *   `auth.api.getSession` returns them without extra queries. All three are
 *   `input: false` — clients can never set privilege or activation state.
 * - The public `/sign-in/email` and `/sign-up/email` HTTP endpoints are
 *   disabled (`disabledPaths`); sign-in/out go through server actions in
 *   `src/lib/auth/actions.ts` so failed attempts can be rate-limited on the
 *   `rate_limits` table. `auth.api.*` calls from server code still work.
 * - Session creation is blocked for deactivated users via a database hook.
 * - Sessions live in the `sessions` table (no secondary storage), last 12h
 *   (one long shift) and refresh at most hourly.
 * - `nextCookies()` must stay last in the plugin array.
 */
const env = serverEnv();

export const auth = betterAuth({
  appName: "Medical Store POS",
  secret: env.AUTH_SECRET,
  ...(env.BETTER_AUTH_URL ? { baseURL: env.BETTER_AUTH_URL } : {}),
  database: drizzleAdapter(getDb(), {
    provider: "sqlite",
    schema: {
      user: users,
      session: sessions,
      account: accounts,
      verification: verifications,
    },
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    /** Accounts are provisioned by admins/seed, never by public sign-up. */
    autoSignIn: false,
  },
  user: {
    additionalFields: {
      role: { type: "string", required: true, defaultValue: "cashier", input: false },
      branchId: { type: "string", required: false, input: false },
      active: { type: "boolean", required: true, defaultValue: true, input: false },
    },
  },
  session: {
    expiresIn: 60 * 60 * 12,
    updateAge: 60 * 60,
  },
  disabledPaths: ["/sign-in/email", "/sign-up/email"],
  databaseHooks: {
    session: {
      create: {
        before: async (session) => {
          const rows = await getDb()
            .select({ active: users.active })
            .from(users)
            .where(eq(users.id, session.userId))
            .limit(1);
          // Returning false cancels session creation entirely.
          return rows[0]?.active === true;
        },
      },
    },
  },
  advanced: {
    database: {
      generateId: () => newId(),
    },
  },
  plugins: [nextCookies()],
});

export type Auth = typeof auth;
