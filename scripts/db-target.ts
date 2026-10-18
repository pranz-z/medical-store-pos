import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { loadScriptEnv } from "./load-env";

/**
 * Resolves the database target for maintenance scripts (seed, reset, smoke)
 * and enforces the safety rule: destructive operations on a non-local database
 * require an explicit `--force` flag.
 */
export interface DbTarget {
  url: string;
  authToken: string | undefined;
  isLocal: boolean;
}

export function resolveDbTarget(operation: string): DbTarget {
  loadScriptEnv();

  const url = process.env.TURSO_DATABASE_URL ?? "file:local.db";
  const authToken = process.env.TURSO_AUTH_TOKEN || undefined;
  const isLocal = url.startsWith("file:");

  if (!isLocal && !process.argv.includes("--force")) {
    console.error(
      `Refusing to ${operation} a non-local database:\n  ${url}\n` +
        `Re-run with --force only if you are sure (e.g. seeding a disposable preview database).`,
    );
    process.exit(1);
  }

  return { url, authToken, isLocal };
}

/** Creates the parent directory for `file:` URLs so libSQL can open them. */
export function ensureLocalDirectory(url: string): void {
  if (url.startsWith("file:")) {
    mkdirSync(dirname(resolve(url.slice("file:".length))), { recursive: true });
  }
}
