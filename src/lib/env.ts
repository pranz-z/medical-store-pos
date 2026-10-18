import { z } from "zod";

/**
 * Server-side environment schema.
 *
 * Validation is lazy (first call) and cached, so tooling that imports modules
 * without a complete environment (typecheck, `drizzle-kit generate`, unit
 * tests) keeps working, while any real server code path fails fast with a
 * clear message when a required variable is missing.
 */
const optionalString = z
  .string()
  .transform((value) => (value.trim().length > 0 ? value : undefined))
  .optional();

const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  /** libSQL/Turso database URL. `file:local.db` for local development. */
  TURSO_DATABASE_URL: z.string().min(1).default("file:local.db"),

  /** Turso auth token. Required when the database URL is remote (`libsql://`). */
  TURSO_AUTH_TOKEN: optionalString,

  /** Secret used to sign session cookies. Required wherever traffic is served. */
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),

  /** Vercel Blob token (prescription scans, backup dumps). Reserved for later milestones. */
  BLOB_READ_WRITE_TOKEN: optionalString,

  /** Sentry DSN. Reserved for later milestones. */
  SENTRY_DSN: optionalString,

  /** Shared secret for Vercel Cron endpoints. Reserved for later milestones. */
  CRON_SECRET: optionalString,

  /** IANA timezone used for receipt dates and report day boundaries. */
  APP_TIMEZONE: z.string().min(1).default("Asia/Manila"),

  /** ISO 4217 currency code used to format money amounts (minor units in the DB). */
  APP_CURRENCY: z
    .string()
    .regex(/^[A-Z]{3}$/, "APP_CURRENCY must be a 3-letter ISO 4217 code (e.g. PHP)")
    .default("PHP"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | undefined;

/** Returns the validated server environment, caching the result. Throws on invalid/missing values. */
export function serverEnv(): ServerEnv {
  if (!cached) {
    const result = serverEnvSchema.safeParse(process.env);
    if (!result.success) {
      throw new Error(`Invalid server environment variables:\n${z.prettifyError(result.error)}`);
    }
    cached = result.data;
  }
  return cached;
}

/** True when a database URL points at a local libSQL file rather than a remote Turso database. */
export function isLocalDatabaseUrl(url: string): boolean {
  return url.startsWith("file:");
}
