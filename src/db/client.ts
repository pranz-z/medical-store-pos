import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";

import * as schema from "@/db/schema";
import { serverEnv } from "@/lib/env";

export type Database = LibSQLDatabase<typeof schema>;

export interface DatabaseHandle {
  client: Client;
  db: Database;
}

/**
 * Creates an isolated libSQL client + Drizzle instance.
 *
 * The app itself uses the module-scoped handle below; tests and scripts create
 * their own isolated handles with this factory.
 */
export function createDatabase(url: string, authToken?: string): DatabaseHandle {
  const client = createClient({ url, ...(authToken ? { authToken } : {}) });
  const db = drizzle(client, { schema });
  return { client, db };
}

let handle: DatabaseHandle | undefined;

/**
 * The app-wide database handle: created once per server process and reused
 * (spec §4.3.3 — never create a client per request).
 */
export function getDatabase(): DatabaseHandle {
  if (!handle) {
    const env = serverEnv();
    handle = createDatabase(env.TURSO_DATABASE_URL, env.TURSO_AUTH_TOKEN);
  }
  return handle;
}

/** Convenience accessor for the Drizzle instance. */
export function getDb(): Database {
  return getDatabase().db;
}
